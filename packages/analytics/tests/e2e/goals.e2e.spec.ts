import { type APIRequestContext, expect, type Page, test } from '@playwright/test'
import {
	BETA,
	docIdBySlug,
	ingested,
	localOrigin,
	login,
	readDocument,
	setTenantCookie,
	tenantId,
} from './helpers'

interface WireGoal {
	slug: string
	name: string
	source: 'config' | 'collection'
}

const METRICS = 'pageviews,conversions,revenue'

const readGoals = async (request: APIRequestContext): Promise<WireGoal[]> => {
	const res = await request.get('/api/_x/goals')
	expect(res.ok(), 'goals endpoint read').toBeTruthy()
	const { goals } = (await res.json()) as { goals: WireGoal[] }
	return goals
}

/**
 * Loads the CTA page and clicks its button, awaiting both beacons rather than polling a read: one
 * taken a moment too early would pin an empty answer in the adapter's cache for minutes.
 */
const visitAndConvert = async (page: Page, path: string, origin = ''): Promise<void> => {
	const pageview = ingested(page)
	await page.goto(`${origin}${path}`)
	await pageview
	const converted = ingested(page)
	await page.getByRole('button', { name: 'Subscribe' }).click()
	await converted
}

test('a CTA block click converts the goal its picker stored', async ({ page }) => {
	await visitAndConvert(page, '/newsletter')

	await login(page.request)
	const newsletter = await docIdBySlug(page.request, 'newsletter')
	const read = await readDocument(page.request, newsletter, METRICS)
	expect(read.status).toBe('ok')
	expect(read.metrics?.pageviews ?? 0).toBeGreaterThanOrEqual(1)
	expect(read.metrics?.conversions ?? 0).toBeGreaterThanOrEqual(1)
	// The seeded goal is worth a fixed 10, so revenue is the proof the collection document
	// matched rather than some config goal that happens to share the click.
	expect(read.metrics?.revenue ?? 0).toBeGreaterThanOrEqual(10)

	const goals = await readGoals(page.request)
	expect(goals.find((goal) => goal.slug === 'newsletter')).toMatchObject({
		source: 'collection',
	})
})

test('@tenancy a tenant CTA converts for its own tenant only', async ({ browser, baseURL }) => {
	const alphaVisitor = await browser.newContext()
	const alphaPage = await alphaVisitor.newPage()
	await visitAndConvert(alphaPage, '/alpha-offer', localOrigin(baseURL, 'alpha'))
	await alphaVisitor.close()

	// Beta loads the same page without converting. Beta has no seeded traffic on this path,
	// so without this its `conversions === 0` would pass vacuously on an empty read.
	const betaVisitor = await browser.newContext()
	const betaPage = await betaVisitor.newPage()
	const betaPageview = ingested(betaPage)
	await betaPage.goto(`${localOrigin(baseURL, 'beta')}/alpha-offer`)
	await betaPageview
	await betaVisitor.close()

	const admin = await browser.newContext()
	await login(admin.request)
	const alphaOffer = await docIdBySlug(admin.request, 'alpha-offer')

	await setTenantCookie(admin, await tenantId(admin.request, 'alpha'), localOrigin(baseURL))
	const alphaRead = await readDocument(admin.request, alphaOffer, METRICS)
	expect(alphaRead.status).toBe('ok')
	expect(alphaRead.metrics?.conversions ?? 0).toBeGreaterThanOrEqual(1)
	expect(alphaRead.metrics?.revenue ?? 0).toBeGreaterThanOrEqual(10)

	await setTenantCookie(admin, await tenantId(admin.request, 'beta'), localOrigin(baseURL))
	const betaRead = await readDocument(admin.request, alphaOffer, METRICS)
	expect(betaRead.status).toBe('ok')
	expect(betaRead.metrics?.pageviews ?? 0).toBeGreaterThanOrEqual(1)
	expect(betaRead.metrics?.conversions).toBe(0)
	await admin.close()

	const betaAdmin = await browser.newContext()
	await login(betaAdmin.request, BETA)
	const betaAdminPage = await betaAdmin.newPage()
	await betaAdminPage.goto('/admin')
	await betaAdminPage.waitForFunction(() => document.cookie.includes('payload-tenant='))

	const betaGoals = await readGoals(betaAdmin.request)
	expect(betaGoals.map((goal) => goal.slug)).toContain('beta-quote')
	expect(betaGoals.map((goal) => goal.slug)).not.toContain('alpha-newsletter')

	const collectionRes = await betaAdmin.request.get('/api/analytics-goals?depth=0&limit=50')
	expect(collectionRes.ok()).toBeTruthy()
	const { docs: goalDocs } = (await collectionRes.json()) as { docs: Array<{ slug: string }> }
	expect(goalDocs.map((doc) => doc.slug)).toEqual(['beta-quote'])
	await betaAdmin.close()
})
