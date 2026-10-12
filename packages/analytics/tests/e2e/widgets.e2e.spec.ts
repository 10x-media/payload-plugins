import {
	type Browser,
	type BrowserContext,
	expect,
	type Locator,
	type Page,
	test,
} from '@playwright/test'
import { localOrigin, login, PLATFORM, search, setTenantCookie, tenantId } from './helpers'

// The deep link lands on the analytics view, which Payload docks its nav beside above
// 1440px and hides behind the hamburger below. Same reason view.e2e.spec.ts sizes up.
test.use({ viewport: { width: 1600, height: 1000 } })

/**
 * Native's twelve channel tokens as `en` names them: the run is on the default English
 * locale, so a channel row never reads as the token it stores.
 */
const CHANNEL_LABELS = [
	'Direct',
	'Organic search',
	'Paid search',
	'Organic social',
	'Paid social',
	'Organic video',
	'Paid video',
	'Email',
	'Affiliate',
	'Display',
	'Referral',
	'Other paid',
]

const goalsWidget = (page: Page): Locator => page.locator('.analytics-goals-widget').first()

const breakdownWidget = (page: Page, title: string): Locator =>
	page.locator('.analytics-breakdown-widget', { hasText: title }).first()

/**
 * "Top pages" is a prefix of "Top pages in Germany", so the filtered pair has to match on
 * the title heading rather than on the card's text.
 */
const breakdownTitled = (page: Page, title: string): Locator =>
	page
		.locator('.analytics-breakdown-widget')
		.filter({ has: page.getByText(title, { exact: true }) })
		.first()

const barRows = async (widget: Locator): Promise<Map<string, number>> => {
	const rows = widget.locator('.analytics-bars__row')
	const entries = await rows.evaluateAll((els) =>
		els.map((el) => [
			el.querySelector('.analytics-bars__label')?.textContent ?? '',
			Number((el.querySelector('.analytics-bars__value')?.textContent ?? '').replace(/[^\d]/g, '')),
		])
	)
	return new Map(entries as Array<[string, number]>)
}

/**
 * Native classifies the referrer host, the browser and the campaign at ingest, so all three
 * widgets rank real rows on a native-only install rather than degrading.
 */
const expectNativeDimensionRows = async (page: Page): Promise<void> => {
	const referrers = breakdownWidget(page, 'Top referrers')
	await expect(referrers).toBeVisible()
	const referrerRows = await barRows(referrers)
	expect(referrerRows.size).toBeGreaterThan(0)
	expect(referrerRows.has('localhost'), 'a same-site referrer is never a referrer row').toBe(false)

	const browsers = breakdownWidget(page, 'Browsers')
	await expect(browsers).toBeVisible()
	expect([...(await barRows(browsers)).keys()]).toContain('Chrome')

	const campaigns = breakdownWidget(page, 'Campaigns')
	await expect(campaigns).toBeVisible()
	expect([...(await barRows(campaigns)).keys()]).toContain('spring')
}

/**
 * First cell's leading digits only: it also carries the comparison delta, so stripping every
 * non-digit would read "10" and a "0%" delta as 100.
 */
const conversionsIn = async (row: Locator): Promise<number> => {
	const text = (await row.getByRole('cell').first().innerText()).trim()
	const leading = /^[\d.,]+/.exec(text)?.[0] ?? ''
	return Number.parseInt(leading.replace(/[^0-9]/g, ''), 10)
}

test('the dashboard renders the goals, events and native dimension widgets', async ({ page }) => {
	await login(page.request)
	await page.goto('/admin')

	// The seed converts its own collection goal throughout the weeks it fills, so the table is
	// populated on a fresh boot rather than depending on a conversion fired by an earlier spec.
	const goals = goalsWidget(page)
	await expect(goals).toBeVisible()
	const row = goals.getByRole('row').filter({ hasText: 'Newsletter signup' })
	await expect(row).toBeVisible()
	expect(await conversionsIn(row)).toBeGreaterThan(0)

	const events = breakdownWidget(page, 'Events')
	await expect(events).toBeVisible()
	await expect(events.locator('.analytics-bars__row').first()).toBeVisible()

	await expect(
		breakdownWidget(page, 'Top referrers').locator('a.analytics-widget__link')
	).toBeVisible()
	await expectNativeDimensionRows(page)

	const channels = breakdownWidget(page, 'Channels')
	await expect(channels).toBeVisible()
	const channelRows = await barRows(channels)
	expect(channelRows.size).toBeGreaterThan(0)
	for (const label of channelRows.keys()) {
		expect(CHANNEL_LABELS, `"${label}" is a named channel rather than a raw token`).toContain(label)
	}

	// The seed layout ticks Compare on one trend widget, which is what draws the legend.
	const legend = page.locator('.analytics-chart__legend').first()
	await expect(legend).toBeVisible()
	await expect(legend).toContainText('Previous period')
})

test('a breakdown widget opens the analytics view on its tab and range', async ({ page }) => {
	await login(page.request)
	await page.goto('/admin')

	// The events widget is the one on a window other than the view's own default, so its
	// link carries a range instead of serializing away to it.
	const link = breakdownWidget(page, 'Events').locator('a.analytics-widget__link')
	await expect(link).toBeVisible()
	await link.click()

	await expect(page).toHaveURL(/\/admin\/analytics/)
	expect(await search(page)).toContain('tab=events')
	expect(await search(page)).toContain('range=last7days')
	await expect(
		page
			.getByRole('tablist', { name: 'Breakdowns' })
			.getByRole('tab', { name: 'Events', exact: true })
	).toHaveAttribute('aria-selected', 'true')
})

test('a filtered widget ranks only matching rows and says so', async ({ page }) => {
	await login(page.request)
	await page.goto('/admin')

	const all = breakdownTitled(page, 'Top pages')
	const filtered = breakdownTitled(page, 'Top pages in Germany')
	await expect(all).toBeVisible()
	await expect(filtered).toBeVisible()
	await expect(filtered).toContainText('Last 30 days where Country is \u2068Germany\u2069')

	const unfiltered = await barRows(all)
	const matching = await barRows(filtered)
	expect(matching.size).toBeGreaterThan(0)
	for (const [label, value] of matching) {
		const total = unfiltered.get(label)
		expect(total, `"${label}" is one of the pages the unfiltered widget ranks`).toBeDefined()
		// One country's share of a path, so strictly fewer than every country's.
		expect(value).toBeLessThan(total ?? 0)
	}
})

test('a browser filter narrows a widget on the native engine', async ({ page }) => {
	await login(page.request)
	await page.goto('/admin')

	// `browser` is classified at ingest and filtered through the raw-event path, so this is
	// the filter surface on a derived dimension rather than on a geo one.
	const all = breakdownTitled(page, 'Top pages')
	const filtered = breakdownTitled(page, 'Top pages in Chrome')
	await expect(filtered).toBeVisible()
	await expect(filtered).toContainText('Last 30 days where Browser is \u2068Chrome\u2069')

	const unfiltered = await barRows(all)
	const matching = await barRows(filtered)
	expect(matching.size).toBeGreaterThan(0)
	for (const [label, value] of matching) {
		expect(unfiltered.get(label), `"${label}" is a page the unfiltered widget ranks`).toBeDefined()
		expect(value).toBeLessThan(unfiltered.get(label) ?? 0)
	}
})

test('a filtered widget opens the analytics view on its filter', async ({ page }) => {
	await login(page.request)
	await page.goto('/admin')

	const link = breakdownTitled(page, 'Top pages in Germany').locator('a.analytics-widget__link')
	await expect(link).toBeVisible()
	await link.click()

	await expect(page).toHaveURL(/\/admin\/analytics/)
	expect(await search(page)).toContain('filters=')
	await expect(page.locator('.analytics-view')).toContainText(/Country is\W{0,3}Germany/)
})

/**
 * A platform admin's dashboard on alpha's host with alpha selected. A platform admin is attributed
 * by the tenant selector, never by the host it browses, so the scope comes from the cookie.
 */
const platformDashboardOnAlpha = async (
	browser: Browser,
	baseURL: string | undefined
): Promise<{ context: BrowserContext; page: Page; origin: string }> => {
	const origin = localOrigin(baseURL, 'alpha')
	const context = await browser.newContext()
	const page = await context.newPage()
	await login(page.request, PLATFORM, origin)
	await setTenantCookie(context, await tenantId(page.request, 'alpha', origin), origin)
	await page.goto(`${origin}/admin`)
	return { context, page, origin }
}

test('@tenancy the goals widget and its deep link stay on the selected tenant', async ({
	browser,
	baseURL,
}) => {
	const { context, page } = await platformDashboardOnAlpha(browser, baseURL)

	const goals = goalsWidget(page)
	await expect(goals).toBeVisible()
	const row = goals.getByRole('row').filter({ hasText: 'Alpha newsletter signup' })
	await expect(row).toBeVisible()
	expect(await conversionsIn(row)).toBeGreaterThan(0)
	await expect(goals).not.toContainText('Beta quote request')

	await goals.locator('a.analytics-widget__link').click()
	await expect(page).toHaveURL(/\/admin\/analytics/)
	expect(await search(page)).toContain('tab=goals')

	const breakdown = page.locator('.analytics-view__breakdown')
	await expect(breakdown.getByText('Alpha newsletter signup', { exact: true })).toBeVisible()
	await expect(breakdown).not.toContainText('Beta quote request')
	await context.close()
})

test('@tenancy the native dimension widgets rank rows for the selected tenant', async ({
	browser,
	baseURL,
}) => {
	const { context, page, origin } = await platformDashboardOnAlpha(browser, baseURL)

	await expectNativeDimensionRows(page)

	const filtered = breakdownTitled(page, 'Top pages in Chrome')
	await expect(filtered).toContainText('Last 30 days where Browser is \u2068Chrome\u2069')
	const scopedRows = await barRows(filtered)
	expect(scopedRows.size).toBeGreaterThan(0)
	const unfiltered = await barRows(breakdownTitled(page, 'Top pages'))
	for (const [label, value] of scopedRows) {
		expect(value).toBeLessThan(unfiltered.get(label) ?? 0)
	}

	// The sources tab defaults to `channel` (named, not raw, in `en`); the hosts the referrers
	// widget ranks are the `referrer` dimension beside it.
	await page.goto(`${origin}/admin/analytics?tab=sources`)
	const breakdown = page.locator('.analytics-view__breakdown')
	await expect(breakdown).toBeVisible()
	const rowLabels = breakdown.locator('.analytics-bars__row .analytics-bars__label')
	await expect(rowLabels.filter({ hasText: /^Organic search$/ })).toBeVisible()
	await expect(breakdown).not.toContainText('localhost')

	await page.goto(`${origin}/admin/analytics?tab=sources&dim=referrer`)
	await expect(breakdown).toBeVisible()
	await expect(breakdown.getByText('google.com', { exact: true })).toBeVisible()
	await expect(breakdown).not.toContainText('localhost')
	await context.close()
})
