import { expect, type Page, test } from '@playwright/test'

const ALPHA = { email: 'alpha@10xmedia.de', password: 'password' }
const BETA = { email: 'beta@10xmedia.de', password: 'password' }

interface SourceEntry {
	id: string
	label: string
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
	const res = await page.request.post('/api/users/login', { data: credentials })
	expect(res.ok(), `login as ${credentials.email}`).toBeTruthy()

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
