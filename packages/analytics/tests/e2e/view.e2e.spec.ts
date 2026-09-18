import { expect, type Page, test } from '@playwright/test'

const PLATFORM = { email: 'dev@10xmedia.de', password: 'password' }
const ALPHA = { email: 'alpha@10xmedia.de', password: 'password' }

// Payload docks its nav above 1440px and hides it behind the hamburger below, where the
// dashboard intercepts a click on a nav link. The view is a desktop surface; test it on one.
test.use({ viewport: { width: 1600, height: 1000 } })

const login = async (
	page: Page,
	credentials: { email: string; password: string },
	origin = ''
): Promise<void> => {
	const res = await page.request.post(`${origin}/api/users/login`, { data: credentials })
	expect(res.ok(), `login as ${credentials.email}`).toBeTruthy()
}

/**
 * Tenant users carry exactly one assigned tenant, auto-selected into `payload-tenant` by
 * the multi-tenant provider on mount. Reloading once that cookie lands avoids racing the
 * `router.refresh()` that selection fires. Same shape as `tenancy.e2e.spec.ts`.
 */
const loginAsTenant = async (
	page: Page,
	credentials: { email: string; password: string }
): Promise<void> => {
	await login(page, credentials)
	await page.goto('/admin')
	await page.waitForFunction(() => document.cookie.includes('payload-tenant='))
	await page.reload()
}

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

const search = (page: Page): Promise<string> => page.evaluate(() => window.location.search)

const tab = (page: Page, name: string) =>
	page.getByRole('tablist', { name: 'Breakdowns' }).getByRole('tab', { name, exact: true })

/**
 * Converts the seeded `newsletter` collection goal through the dev site's CTA, so the
 * goals tab and panel have a row to list. The read must happen after the conversion: an
 * aggregate read taken a moment too early pins an empty answer in the cache for minutes.
 */
const convertNewsletterGoal = async (page: Page): Promise<void> => {
	await page.goto('/newsletter')
	const converted = page.waitForResponse(
		(res) => res.url().includes('/api/analytics/ingest') && res.request().method() === 'POST'
	)
	await page.getByRole('button', { name: 'Subscribe' }).click()
	await converted
}

test('the analytics view reads seeded traffic, filters from the URL and keeps history', async ({
	page,
}) => {
	await convertNewsletterGoal(page)
	await login(page, PLATFORM)

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
	const chip = page.getByRole('button', { name: /^Remove filter/ })
	await expect(chip).toBeVisible()
	await expect.poll(() => cardValue(page, 'Pageviews')).toBeLessThan(pageviews)

	await chip.click()
	await expect(chip).toBeHidden()
	await expect.poll(() => search(page)).not.toContain('filters=')

	await tab(page, 'Goals').click()
	await expect.poll(() => search(page)).toContain('tab=goals')
	await expect(tab(page, 'Goals')).toHaveAttribute('aria-selected', 'true')
	// The breakdown lists the goal slug the conversion carried; the panel below names it.
	await expect(
		page.locator('.analytics-view__breakdown').getByText('newsletter', { exact: true })
	).toBeVisible()
	await expect(page.getByRole('cell', { name: 'Newsletter signup' })).toBeVisible()

	await page.goBack()
	await expect.poll(() => search(page)).not.toContain('tab=goals')
	await expect(tab(page, 'Pages')).toHaveAttribute('aria-selected', 'true')
})

test('the sources tab ranks referrer hosts and never the site itself', async ({ page }) => {
	await login(page, PLATFORM)
	await page.goto('/admin/analytics?tab=sources&dim=referrer')

	// The seed's same-site referrer is deliberately absent: a site is not its own referrer.
	const breakdown = page.locator('.analytics-view__breakdown')
	await expect(breakdown.getByText('google.com', { exact: true })).toBeVisible()
	await expect(breakdown).not.toContainText('localhost')
})

/**
 * Every channel the seed produces, named as `en` names them: the run is on the default
 * English locale, so a row reads as the `channel*` translation of the token it stores.
 * There are exactly ten of them, which is the row limit the view opens on, so the URLs below
 * widen it rather than leaving the last one to whichever way a tie broke.
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
]

test('the sources tab opens on channels and filters on the raw token', async ({ page }) => {
	await login(page, PLATFORM)
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
		page.getByRole('button', { name: 'Remove filter: Channel = Paid search' })
	).toBeVisible()
})

test('the source dimension names the origin a visit arrived from', async ({ page }) => {
	await login(page, PLATFORM)
	await page.goto('/admin/analytics?tab=sources&dim=source&limit=25')

	// `utm_source` when the landing was tagged, the referring host when it was not, so both
	// kinds of name rank side by side in the one column.
	const breakdown = page.locator('.analytics-view__breakdown')
	await expect(breakdown.getByText('newsletter', { exact: true })).toBeVisible()
	await expect(breakdown.getByText('google.com', { exact: true })).toBeVisible()
})

test('the group-by picker regroups a tab and writes the pick to the URL', async ({ page }) => {
	await login(page, PLATFORM)
	await page.goto('/admin/analytics?tab=technology')

	// Native serves three technology dimensions, so the tab opens on its default and offers
	// the other two. Devices first; browsers are one pick away.
	const breakdown = page.locator('.analytics-view__breakdown')
	await expect(breakdown.getByText('desktop', { exact: true })).toBeVisible()

	const picker = breakdown.locator('.analytics-view__control').first()
	await picker.locator('.rs__control').click()
	await page.locator('.rs__option', { hasText: 'Browser' }).first().click()

	await expect.poll(() => search(page)).toContain('dim=browser')
	await expect(breakdown.getByText('chrome', { exact: true })).toBeVisible()
})

test('@tenancy the view reports the selected tenant and never another one', async ({
	browser,
	baseURL,
}) => {
	// Chromium resolves every *.localhost name to loopback, so the platform admin browses a
	// real tenant subdomain with no DNS or hosts-file setup.
	const port = new URL(baseURL ?? 'http://localhost:3100').port
	const origin = `http://alpha.localhost:${port}`

	// Alpha's own tenant user is the reference: their scope is their one tenant, with no
	// selector to race. The platform admin below has to arrive at the same number.
	const alpha = await browser.newContext()
	const alphaPage = await alpha.newPage()
	await loginAsTenant(alphaPage, ALPHA)
	await alphaPage.goto('/admin/analytics')
	const alphaPageviews = await settledPageviews(alphaPage)

	await alphaPage.locator('.analytics-view__control .rs__control').first().click()
	const options = alphaPage.locator('.rs__option')
	await expect(options.first()).toBeVisible()
	const labels = await options.allInnerTexts()
	expect(labels.some((label) => label.includes('Alpha Plausible'))).toBe(true)
	expect(labels.some((label) => label.includes('Beta'))).toBe(false)
	await alpha.close()

	const platform = await browser.newContext()
	const platformPage = await platform.newPage()
	await login(platformPage, PLATFORM, origin)
	await platformPage.goto(`${origin}/admin/analytics`)

	const selector = platformPage.locator('.tenant-selector')
	await expect(selector).toBeVisible()
	/**
	 * Selecting a tenant writes the cookie and fires a `router.refresh()`. The two are not
	 * ordered: a refresh that reaches the server before the cookie commits re-renders on the
	 * old scope, the client's scope key is unchanged, and nothing remounts, so a poll on the
	 * numbers alone can only time out. Wait for the selector to show the new tenant, which is
	 * the cookie having landed, then navigate, so the scope is resolved by a fresh request.
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
