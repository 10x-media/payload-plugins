import { expect, type Page, test } from '@playwright/test'
import { ALPHA, ingested, localOrigin, login, loginAsTenant, PLATFORM, search } from './helpers'

// Payload docks its nav above 1440px and hides it behind the hamburger below, where the
// dashboard intercepts a click on a nav link. The view is a desktop surface; test it on one.
test.use({ viewport: { width: 1600, height: 1000 } })

const overviewCard = (page: Page, metric: string) =>
	page
		.getByRole('group', { name: 'Overview' })
		.getByRole('button', { name: new RegExp(`^${metric}`) })

const cardValue = async (page: Page, metric: string): Promise<number> =>
	Number.parseInt((await overviewCard(page, metric).innerText()).replace(/[^0-9]/g, ''), 10)

/**
 * The cards read through the client, so the first paint is a skeleton and the number
 * arrives a request later. Polling to a real number is what every later assertion needs.
 */
const settledPageviews = async (page: Page): Promise<number> => {
	await expect(overviewCard(page, 'Pageviews')).toBeVisible()
	await expect.poll(() => cardValue(page, 'Pageviews'), { timeout: 20_000 }).toBeGreaterThan(0)
	return await cardValue(page, 'Pageviews')
}

const tab = (page: Page, name: string) =>
	page.getByRole('tablist', { name: 'Breakdowns' }).getByRole('tab', { name, exact: true })

/**
 * Converts the seeded `newsletter` goal before any read: one taken too early pins an empty answer
 * in the cache for minutes. Awaiting the pageview first leaves the click's beacon alone in flight.
 */
const convertNewsletterGoal = async (page: Page): Promise<void> => {
	const pageview = ingested(page)
	await page.goto('/newsletter')
	await pageview
	const converted = ingested(page)
	await page.getByRole('button', { name: 'Subscribe' }).click()
	await converted
}

test('the analytics view reads seeded traffic, filters from the URL and keeps history', async ({
	page,
}) => {
	await convertNewsletterGoal(page)
	await login(page.request)

	await page.goto('/admin')
	await page.locator('#nav-analytics').click()
	await expect(page).toHaveURL(/\/admin\/analytics$/)

	const pageviews = await settledPageviews(page)
	expect(pageviews).toBeGreaterThan(0)
	await expect(overviewCard(page, 'Pageviews')).toHaveAttribute('aria-pressed', 'true')
	await expect(page.getByRole('img', { name: /^Pageviews / })).toBeVisible()

	await expect(tab(page, 'Pages')).toHaveAttribute('aria-selected', 'true')

	const row = page.locator('.analytics-view__breakdown').getByRole('button', { name: /\/pricing/ })
	await expect(row).toBeVisible()
	await row.click()

	await expect.poll(() => search(page)).toContain('filters=')
	const chip = page.getByRole('button', { name: /^Remove filter/ }).first()
	await expect(chip).toBeVisible()
	await expect.poll(() => cardValue(page, 'Pageviews')).toBeLessThan(pageviews)

	await chip.click()
	await expect(chip).toBeHidden()
	await expect.poll(() => search(page)).not.toContain('filters=')
	// The sections above the tabs repaint with the unfiltered numbers and move them as they do,
	// so the next click waits for the overview to settle back on the total it started from.
	await expect.poll(() => cardValue(page, 'Pageviews')).toBe(pageviews)
	await expect(page.locator('.analytics-view [aria-busy="true"]')).toHaveCount(0)

	await tab(page, 'Goals').click()
	await expect.poll(() => search(page)).toContain('tab=goals')
	await expect(tab(page, 'Goals')).toHaveAttribute('aria-selected', 'true')
	await expect(
		page.locator('.analytics-view__breakdown').getByText('Newsletter signup', { exact: true })
	).toBeVisible()
	await expect(
		page
			.getByRole('region', { name: 'Goals' })
			.getByRole('rowheader', { name: 'Newsletter signup' })
	).toBeVisible()

	await page.goBack()
	await expect.poll(() => search(page)).not.toContain('tab=goals')
	await expect(tab(page, 'Pages')).toHaveAttribute('aria-selected', 'true')
})

interface AnalyticsCall {
	method: string
	path: string
	status: number
}

/**
 * Records answered analytics calls in order, so a refresh is asserted on the requests it issues
 * rather than on numbers a cached read would leave unchanged.
 */
const recordAnalyticsCalls = (page: Page): AnalyticsCall[] => {
	const calls: AnalyticsCall[] = []
	page.on('response', (res) => {
		const path = new URL(res.url()).pathname
		if (path.startsWith('/api/_x/')) {
			calls.push({ method: res.request().method(), path, status: res.status() })
		}
	})
	return calls
}

const queriesAfterRefresh = (calls: AnalyticsCall[]): number => {
	const refreshed = calls.findIndex(
		(call) => call.method === 'POST' && call.path === '/api/_x/refresh'
	)
	if (refreshed === -1) {
		return 0
	}
	return calls
		.slice(refreshed + 1)
		.filter((call) => call.method === 'GET' && call.path === '/api/_x/query').length
}

/** Clicks Refresh and waits for the endpoint's own 200, so the assertions race nothing. */
const clickRefresh = async (page: Page): Promise<void> => {
	const refreshed = page.waitForResponse(
		(res) =>
			res.url().includes('/api/_x/refresh') &&
			res.request().method() === 'POST' &&
			res.status() === 200
	)
	await page.getByRole('button', { name: 'Refresh' }).click()
	await refreshed
}

test('the Refresh button invalidates the cached reads and reissues every section', async ({
	page,
}) => {
	await login(page.request)
	await page.goto('/admin/analytics')
	await settledPageviews(page)

	const calls = recordAnalyticsCalls(page)
	await clickRefresh(page)

	// Four sections read through the query endpoint: cards, trend, breakdown and goals.
	await expect.poll(() => queriesAfterRefresh(calls), { timeout: 20_000 }).toBeGreaterThanOrEqual(4)
	expect(calls.filter((call) => call.path === '/api/_x/refresh')).toHaveLength(1)
	await expect(page.getByRole('button', { name: 'Refresh' })).toBeEnabled()
})

test("@tenancy the Refresh button refreshes a tenant reader's own scope", async ({ page }) => {
	await loginAsTenant(page, ALPHA)
	await page.goto('/admin/analytics')
	await settledPageviews(page)

	const calls = recordAnalyticsCalls(page)
	await clickRefresh(page)

	await expect.poll(() => queriesAfterRefresh(calls), { timeout: 20_000 }).toBeGreaterThanOrEqual(4)
})

test('the sources tab ranks referrer hosts and never the site itself', async ({ page }) => {
	await login(page.request)
	await page.goto('/admin/analytics?tab=sources&dim=referrer')

	// The seed's same-site referrer is deliberately absent: a site is not its own referrer.
	const breakdown = page.locator('.analytics-view__breakdown')
	await expect(breakdown.getByText('google.com', { exact: true })).toBeVisible()
	await expect(breakdown).not.toContainText('localhost')
})

/**
 * Every channel the seed produces, as `en` names them. Twelve, more than the ten rows the view
 * opens on, so the URLs below widen it.
 */
const SEED_CHANNELS = [
	'Direct',
	'Organic search',
	'Organic social',
	'Organic video',
	'Referral',
	'Email',
	'Affiliate',
	'Display',
	'Paid search',
	'Paid social',
	'Paid video',
	'Other paid',
]

test('the sources tab opens on channels and filters on the raw token', async ({ page }) => {
	await login(page.request)
	await page.goto('/admin/analytics?tab=sources&limit=25')

	const breakdown = page.locator('.analytics-view__breakdown')
	// `has` matches inside the row it filters, so its locator is rooted at the page rather
	// than chained off the breakdown, which would resolve outside the row and match nothing.
	const label = (name: string) =>
		page.locator('.analytics-bars__label', { hasText: new RegExp(`^${name}$`) })
	for (const channel of SEED_CHANNELS) {
		await expect(
			breakdown.locator('.analytics-bars__label', { hasText: new RegExp(`^${channel}$`) })
		).toBeVisible()
	}
	// A channel classifies the origin rather than naming it, so no row here is a hostname.
	await expect(breakdown).not.toContainText('google.com')

	await breakdown
		.locator('.analytics-bars__row--action')
		.filter({ has: label('Paid search') })
		.click()

	// The filter and the URL carry the stored token; only the row and the chip are named.
	const filters = async (): Promise<unknown> => {
		const raw = new URLSearchParams(await search(page)).get('filters')
		return raw === null ? null : JSON.parse(raw)
	}
	await expect
		.poll(filters)
		.toEqual([{ dimension: 'channel', operator: 'eq', value: 'paid-search' }])
	await expect(
		page
			.getByRole('button', { name: /^Remove filter: Channel is \u2068?Paid search\u2069?$/ })
			.first()
	).toBeVisible()
})

test('the source dimension names the origin a visit arrived from', async ({ page }) => {
	await login(page.request)
	await page.goto('/admin/analytics?tab=sources&dim=source&limit=25')

	// `utm_source` when the landing was tagged, the referring host when it was not, so both
	// kinds of name rank side by side in the one column.
	const breakdown = page.locator('.analytics-view__breakdown')
	await expect(breakdown.getByText('newsletter', { exact: true })).toBeVisible()
	await expect(breakdown.getByText('google.com', { exact: true })).toBeVisible()
})

test('the group-by picker regroups a tab and writes the pick to the URL', async ({ page }) => {
	await login(page.request)
	await page.goto('/admin/analytics?tab=technology')

	// Native serves three technology dimensions, so the tab opens on its default and offers
	// the other two. Devices first; browsers are one pick away.
	const breakdown = page.locator('.analytics-view__breakdown')
	await expect(breakdown.getByText('Desktop', { exact: true })).toBeVisible()

	const picker = breakdown.locator('.analytics-view__control').first()
	await picker.locator('.rs__control').click()
	await page.locator('.rs__option', { hasText: 'Browser' }).first().click()

	await expect.poll(() => search(page)).toContain('dim=browser')
	await expect(breakdown.getByText('Chrome', { exact: true })).toBeVisible()
})

test('@tenancy the view reports the selected tenant and never another one', async ({
	browser,
	baseURL,
}) => {
	const origin = localOrigin(baseURL, 'alpha')

	// Alpha's own tenant user is the reference: their scope is their one tenant, with no
	// selector to race. The platform admin below has to arrive at the same number.
	const alpha = await browser.newContext()
	const alphaPage = await alpha.newPage()
	await loginAsTenant(alphaPage, ALPHA)
	await alphaPage.goto('/admin/analytics')
	const alphaPageviews = await settledPageviews(alphaPage)

	// Alpha's one source needs no picker, and the view names the tenant it reports on.
	const view = alphaPage.locator('.analytics-view')
	await expect(view).toContainText(/Showing:\W{0,3}Alpha/)
	await expect(alphaPage.getByRole('combobox', { name: 'Data source' })).toHaveCount(0)
	await expect(view).not.toContainText('Beta')
	await alpha.close()

	const platform = await browser.newContext()
	const platformPage = await platform.newPage()
	await login(platformPage.request, PLATFORM, origin)
	await platformPage.goto(`${origin}/admin/analytics`)

	const selector = platformPage.locator('.tenant-selector')
	await expect(selector).toBeVisible()
	/**
	 * Cookie write and `router.refresh()` are unordered, so a poll alone can stick on the old scope.
	 * Waits for the selector to show the tenant (cookie landed), then navigates for a fresh request.
	 */
	const selectTenant = async (name: string): Promise<void> => {
		await selector.locator('.rs__control').click()
		await platformPage.locator('.rs__option', { hasText: name }).first().click()
		await expect(selector).toContainText(name)
		await platformPage.goto(`${origin}/admin/analytics`)
	}

	await selectTenant('Alpha')
	await expect
		.poll(() => cardValue(platformPage, 'Pageviews'), { timeout: 20_000 })
		.toBe(alphaPageviews)

	await selectTenant('Beta')
	await expect
		.poll(() => cardValue(platformPage, 'Pageviews'), { timeout: 20_000 })
		.not.toBe(alphaPageviews)
	const betaPageviews = await cardValue(platformPage, 'Pageviews')
	expect(betaPageviews).toBeGreaterThan(0)
	expect(alphaPageviews).toBeGreaterThan(betaPageviews)
	await platform.close()
})
