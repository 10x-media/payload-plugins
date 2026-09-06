import { expect, type Page, test } from '@playwright/test'

const ALPHA = { email: 'alpha@10xmedia.de', password: 'password' }
const BETA = { email: 'beta@10xmedia.de', password: 'password' }
const PLATFORM = { email: 'dev@10xmedia.de', password: 'password' }

interface SourceEntry {
	id: string
	label: string
}

/** Authenticates the page's request context; does not touch the tenant-selector cookie. */
const login = async (
	page: Page,
	credentials: { email: string; password: string }
): Promise<void> => {
	const res = await page.request.post('/api/users/login', { data: credentials })
	expect(res.ok(), `login as ${credentials.email}`).toBeTruthy()
}

/**
 * Tenant users carry exactly one assigned tenant. The multi-tenant plugin's client
 * provider auto-selects it into the `payload-tenant` cookie on mount and calls
 * `router.refresh()`; reloading once that cookie lands avoids racing that refresh, so
 * every read after this call sees one deterministic, tenant-scoped server render.
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

const readPageviewsMetric = async (page: Page): Promise<number> => {
	const widget = page.locator('.analytics-metric-widget', { hasText: 'Pageviews' }).first()
	await expect(widget).toBeVisible()
	const text = (await widget.locator('span').nth(1).innerText()).trim()
	return Number.parseInt(text.replace(/[^0-9]/g, ''), 10)
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

test('@tenancy sources endpoint only lists the caller tenant provider', async ({ page }) => {
	await loginAsTenant(page, ALPHA)

	const res = await page.request.get('/api/analytics/sources')
	expect(res.ok()).toBeTruthy()
	const body = (await res.json()) as { sources: SourceEntry[] }

	const alphaSource = body.sources.find((s) => s.label === 'Alpha Plausible')
	expect(alphaSource).toBeDefined()
	expect(alphaSource?.id.startsWith('plausible:')).toBe(true)
	expect(body.sources.some((s) => s.label === 'Beta Plausible')).toBe(false)
})

test('@tenancy analytics providers list redirects to the tenant single doc', async ({ page }) => {
	await loginAsTenant(page, ALPHA)

	await page.goto('/admin/collections/analytics-providers')
	await expect(page).toHaveURL(/\/admin\/collections\/analytics-providers\/[^/]+$/)
	await expect(page.getByLabel('Name')).toHaveValue('Alpha Plausible')
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
	const platformLogin = await platformContext.request.post('/api/users/login', {
		data: PLATFORM,
	})
	expect(platformLogin.ok(), 'login as platform admin').toBeTruthy()
	const tenantsRes = await platformContext.request.get(
		'/api/tenants?where[slug][equals]=beta&depth=0'
	)
	expect(tenantsRes.ok()).toBeTruthy()
	const { docs: tenants } = (await tenantsRes.json()) as { docs: Array<{ id: string | number }> }
	const betaId = tenants[0]?.id
	expect(betaId, 'beta tenant lookup').toBeDefined()
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
	await page
		.context()
		.addCookies([{ name: 'payload-tenant', value: String(betaId), url: baseURL ?? page.url() }])

	// The dev scopeResolver throws for a tenant alpha does not belong to; the sources
	// endpoint degrades to the static config registry, never a tenant's providers.
	const sourcesRes = await page.request.get('/api/analytics/sources')
	expect(sourcesRes.ok()).toBeTruthy()
	const { sources } = (await sourcesRes.json()) as {
		sources: Array<SourceEntry & { kind: string }>
	}
	expect(sources.some((s) => s.label === 'Beta Plausible')).toBe(false)
	expect(sources.some((s) => s.kind === 'runtime')).toBe(false)

	// The same failure degrades the server-rendered dashboard read to unavailable, so no
	// pageviews number renders; beta's never does.
	await page.reload()
	const forgedPageviews = await readPageviewsMetric(page)
	expect(forgedPageviews).not.toBe(betaPageviews)
	expect(Number.isNaN(forgedPageviews) || forgedPageviews === alphaPageviews).toBe(true)
})
