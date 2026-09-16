import { expect, type Locator, type Page, test } from '@playwright/test'

const PLATFORM = { email: 'dev@10xmedia.de', password: 'password' }

// The deep link lands on the analytics view, which Payload docks its nav beside above
// 1440px and hides behind the hamburger below. Same reason view.e2e.spec.ts sizes up.
test.use({ viewport: { width: 1600, height: 1000 } })

const login = async (
	page: Page,
	credentials: { email: string; password: string },
	origin = ''
): Promise<void> => {
	const res = await page.request.post(`${origin}/api/users/login`, { data: credentials })
	expect(res.ok(), `login as ${credentials.email}`).toBeTruthy()
}

const search = (page: Page): Promise<string> => page.evaluate(() => window.location.search)

const goalsWidget = (page: Page): Locator => page.locator('.analytics-goals-widget').first()

const breakdownWidget = (page: Page, title: string): Locator =>
	page.locator('.analytics-breakdown-widget', { hasText: title }).first()

/**
 * "Top pages" is a prefix of "Top pages in Germany", so the filtered pair has to match on
 * the title span rather than on the card's text.
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
 * The conversions cell carries the comparison delta beside the number, so only the leading
 * digits are the count: stripping every non-digit would read "10" and a "0%" delta as 100.
 */
const conversionsIn = async (row: Locator): Promise<number> => {
	const text = (await row.getByRole('cell').nth(1).innerText()).trim()
	const leading = /^[\d.,]+/.exec(text)?.[0] ?? ''
	return Number.parseInt(leading.replace(/[^0-9]/g, ''), 10)
}

test('the dashboard renders the goals, events and referrers widgets', async ({ page }) => {
	await login(page, PLATFORM)
	await page.goto('/admin')

	// The seed converts its own collection goal across the dense span, so the table is
	// populated on a fresh boot rather than depending on a conversion fired by an earlier spec.
	const goals = goalsWidget(page)
	await expect(goals).toBeVisible()
	const row = goals.getByRole('row').filter({ hasText: 'Newsletter signup' })
	await expect(row).toBeVisible()
	expect(await conversionsIn(row)).toBeGreaterThan(0)

	const events = breakdownWidget(page, 'Events')
	await expect(events).toBeVisible()
	await expect(events.locator('.analytics-bars__row').first()).toBeVisible()

	// The native engine serves no `referrer` dimension, so the widget registers (runtime
	// providers keep the install open-world) and degrades rather than rendering rows.
	const referrers = breakdownWidget(page, 'Top referrers')
	await expect(referrers).toBeVisible()
	await expect(referrers).toContainText('Not available for this data source')
	await expect(referrers.locator('a.analytics-widget__link')).toBeVisible()

	// The seed layout ticks Compare on one trend widget, which is what draws the legend.
	const legend = page.locator('.analytics-chart__legend').first()
	await expect(legend).toBeVisible()
	await expect(legend).toContainText('Previous period')
})

test('a breakdown widget opens the analytics view on its tab and range', async ({ page }) => {
	await login(page, PLATFORM)
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
	await login(page, PLATFORM)
	await page.goto('/admin')

	const all = breakdownTitled(page, 'Top pages')
	const filtered = breakdownTitled(page, 'Top pages in Germany')
	await expect(all).toBeVisible()
	await expect(filtered).toBeVisible()
	await expect(filtered).toContainText('Last 30 days where Country is DE')

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

test('a filtered widget opens the analytics view on its filter', async ({ page }) => {
	await login(page, PLATFORM)
	await page.goto('/admin')

	const link = breakdownTitled(page, 'Top pages in Germany').locator('a.analytics-widget__link')
	await expect(link).toBeVisible()
	await link.click()

	await expect(page).toHaveURL(/\/admin\/analytics/)
	expect(await search(page)).toContain('filters=')
	await expect(page.locator('.analytics-view')).toContainText('Country = DE')
})

test('@tenancy the goals widget and its deep link stay on the selected tenant', async ({
	browser,
	baseURL,
}) => {
	// Chromium resolves every *.localhost name to loopback, so the platform admin browses a
	// real tenant subdomain with no DNS or hosts-file setup. The session cookie is host-bound,
	// so the login has to happen on that origin too.
	const port = new URL(baseURL ?? 'http://localhost:3100').port
	const origin = `http://alpha.localhost:${port}`

	const context = await browser.newContext()
	const page = await context.newPage()
	await login(page, PLATFORM, origin)

	const tenantsRes = await page.request.get(`${origin}/api/tenants?depth=0&limit=10`)
	expect(tenantsRes.ok()).toBeTruthy()
	const { docs: tenants } = (await tenantsRes.json()) as {
		docs: Array<{ id: string | number; slug: string }>
	}
	const alphaId = tenants.find((t) => t.slug === 'alpha')?.id
	expect(alphaId, 'tenant "alpha" seeded').toBeDefined()

	// A platform admin is attributed by the tenant selector, never by the host they happen to
	// be on, so the scope comes from this cookie rather than from alpha.localhost.
	await context.addCookies([{ name: 'payload-tenant', value: String(alphaId), url: origin }])
	await page.goto(`${origin}/admin`)

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
	await expect(breakdown.getByText('alpha-newsletter', { exact: true })).toBeVisible()
	await expect(breakdown).not.toContainText('beta-quote')
	await context.close()
})
