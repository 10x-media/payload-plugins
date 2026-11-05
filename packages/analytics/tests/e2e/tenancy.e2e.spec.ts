import { expect, type Page, test } from '@playwright/test'
import { ALPHA, BETA, login, loginAsTenant, setTenantCookie, tenantId } from './helpers'

interface SourceEntry {
	id: string
	label: string
}

/** The settled card's number, or NaN when it settled on a state that shows none. */
const readPageviewsMetric = async (page: Page): Promise<number> => {
	const widget = page
		.locator('.analytics-metric-widget:not(.analytics-widget--loading)', { hasText: 'Pageviews' })
		.first()
	await expect(widget).toBeVisible()
	const value = widget.locator('.analytics-widget__value')
	if ((await value.count()) === 0) {
		return Number.NaN
	}
	return Number.parseInt((await value.innerText()).replace(/[^0-9]/g, ''), 10)
}

test('@tenancy dashboard pageviews are isolated per tenant', async ({ browser }) => {
	const alphaContext = await browser.newContext()
	const alphaPage = await alphaContext.newPage()
	await loginAsTenant(alphaPage, ALPHA)
	const alphaPageviews = await readPageviewsMetric(alphaPage)
	await alphaContext.close()

	const betaContext = await browser.newContext()
	const betaPage = await betaContext.newPage()
	await loginAsTenant(betaPage, BETA)
	const betaPageviews = await readPageviewsMetric(betaPage)
	await betaContext.close()

	expect(alphaPageviews).toBeGreaterThan(betaPageviews)
})

// The seed gives alpha one provider document, its site database on native, and beta two: its own
// site database and a Plausible project.
test('@tenancy sources endpoint only lists the caller tenant provider', async ({ page }) => {
	await loginAsTenant(page, ALPHA)

	const res = await page.request.get('/api/_x/sources')
	expect(res.ok()).toBeTruthy()
	const body = (await res.json()) as { sources: SourceEntry[] }

	expect(body.sources.map((s) => s.label)).toEqual(['Alpha site database'])
	expect(body.sources[0]?.id).toBe('native')
})

test("@tenancy the analytics providers list holds only the tenant's own documents", async ({
	page,
}) => {
	await loginAsTenant(page, ALPHA)

	await page.goto('/admin/collections/analytics-providers')
	await expect(page.getByRole('link', { name: 'Alpha site database' })).toBeVisible()
	await expect(page.locator('body')).not.toContainText('Beta site database')
	await expect(page.locator('body')).not.toContainText('Beta Plausible')
})

test('@tenancy a forged tenant cookie cannot read another tenant', async ({
	browser,
	page,
	baseURL,
}) => {
	// The plugin filters the `tenants` collection per user, so alpha's own session cannot
	// see beta at all; a separate platform-admin session looks up the id to forge.
	const platformContext = await browser.newContext()
	await login(platformContext.request)
	const betaId = await tenantId(platformContext.request, 'beta')
	await platformContext.close()

	const betaContext = await browser.newContext()
	const betaPage = await betaContext.newPage()
	await loginAsTenant(betaPage, BETA)
	const betaPageviews = await readPageviewsMetric(betaPage)
	await betaContext.close()

	await loginAsTenant(page, ALPHA)
	const alphaPageviews = await readPageviewsMetric(page)
	expect(alphaPageviews).not.toBe(betaPageviews)

	// Forge the client-set selector cookie onto alpha's authenticated session: alpha is
	// still `req.user`, only the claimed tenant changes.
	await setTenantCookie(page.context(), betaId, baseURL ?? page.url())

	// `scope.resolve` selects beta from the cookie and `scope.member` refuses it, so the answer is
	// empty rather than beta's sources or a fallback to the config registry.
	const sourcesRes = await page.request.get('/api/_x/sources')
	expect(sourcesRes.ok()).toBeTruthy()
	const { sources } = (await sourcesRes.json()) as {
		sources: Array<SourceEntry & { kind: string }>
	}
	expect(sources).toEqual([])

	// The same refusal turns the server-rendered dashboard read into its no-access state, so no
	// pageviews number renders; beta's never does.
	await page.reload()
	const forgedPageviews = await readPageviewsMetric(page)
	expect(forgedPageviews).not.toBe(betaPageviews)
	expect(Number.isNaN(forgedPageviews) || forgedPageviews === alphaPageviews).toBe(true)
})
