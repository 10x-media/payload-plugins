import {
	type APIRequestContext,
	type BrowserContext,
	expect,
	type Page,
	test,
} from '@playwright/test'

const PLATFORM = { email: 'dev@10xmedia.de', password: 'password' }
const BETA = { email: 'beta@10xmedia.de', password: 'password' }

interface DocumentRead {
	status: string
	metrics?: { pageviews?: number; conversions?: number; revenue?: number }
}

interface WireGoal {
	slug: string
	name: string
	source: 'config' | 'collection'
}

const login = async (
	request: APIRequestContext,
	credentials: { email: string; password: string }
): Promise<void> => {
	const res = await request.post('/api/users/login', { data: credentials })
	expect(res.ok(), `login as ${credentials.email}`).toBeTruthy()
}

const docIdBySlug = async (request: APIRequestContext, slug: string): Promise<string> => {
	const res = await request.get(`/api/pages?where[slug][equals]=${slug}&depth=0&limit=1`)
	expect(res.ok(), `lookup page "${slug}"`).toBeTruthy()
	const { docs } = (await res.json()) as { docs: Array<{ id: string | number }> }
	const id = docs[0]?.id
	expect(id, `page "${slug}" seeded`).toBeDefined()
	return String(id)
}

const readDocument = async (request: APIRequestContext, id: string): Promise<DocumentRead> => {
	const res = await request.get(
		`/api/analytics/document?collection=pages&id=${id}&metrics=pageviews,conversions,revenue`
	)
	expect(res.ok(), 'document analytics read').toBeTruthy()
	return (await res.json()) as DocumentRead
}

const readGoals = async (request: APIRequestContext): Promise<WireGoal[]> => {
	const res = await request.get('/api/analytics/goals')
	expect(res.ok(), 'goals endpoint read').toBeTruthy()
	const { goals } = (await res.json()) as { goals: WireGoal[] }
	return goals
}

const ingested = (page: Page): Promise<unknown> =>
	page.waitForResponse(
		(res) => res.url().includes('/api/analytics/ingest') && res.request().method() === 'POST'
	)

/**
 * Loads the CTA page, clicks its button, then leaves. Same shape as capture.e2e.spec.ts:
 * the conversion goes out on the click and the pageview only on the navigation's
 * `pagehide`, and both are awaited rather than polled for, because an aggregate read taken
 * a moment too early would pin an empty answer in the adapter's cache for minutes.
 */
const visitAndConvert = async (page: Page, path: string, origin = ''): Promise<void> => {
	await page.goto(`${origin}${path}`)
	const converted = ingested(page)
	await page.getByRole('button', { name: 'Subscribe' }).click()
	await converted
	const pageview = ingested(page)
	await page.goto(`${origin}/`)
	await pageview
}

test('a CTA block click converts the goal its picker stored', async ({ page }) => {
	await visitAndConvert(page, '/newsletter')

	await login(page.request, PLATFORM)
	const newsletter = await docIdBySlug(page.request, 'newsletter')
	const read = await readDocument(page.request, newsletter)
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
	// Chromium resolves every *.localhost name to loopback, so the dev app's hostname scope
	// resolver sees a real tenant subdomain with no DNS or hosts-file setup.
	const port = new URL(baseURL ?? 'http://localhost:3100').port

	const alphaVisitor = await browser.newContext()
	const alphaPage = await alphaVisitor.newPage()
	await visitAndConvert(alphaPage, '/alpha-offer', `http://alpha.localhost:${port}`)
	await alphaVisitor.close()

	// Beta loads the same page without converting. Beta has no seeded traffic on this path,
	// so without this its `conversions === 0` would pass vacuously on an empty read.
	const betaVisitor = await browser.newContext()
	const betaPage = await betaVisitor.newPage()
	await betaPage.goto(`http://beta.localhost:${port}/alpha-offer`)
	const betaPageview = ingested(betaPage)
	await betaPage.goto(`http://beta.localhost:${port}/`)
	await betaPageview
	await betaVisitor.close()

	const admin = await browser.newContext()
	await login(admin.request, PLATFORM)
	const alphaOffer = await docIdBySlug(admin.request, 'alpha-offer')

	const tenantsRes = await admin.request.get('/api/tenants?depth=0&limit=10')
	expect(tenantsRes.ok()).toBeTruthy()
	const { docs: tenants } = (await tenantsRes.json()) as {
		docs: Array<{ id: string | number; slug: string }>
	}
	const idOf = (slug: string): string => {
		const id = tenants.find((t) => t.slug === slug)?.id
		expect(id, `tenant "${slug}" seeded`).toBeDefined()
		return String(id)
	}
	const selectTenant = async (context: BrowserContext, id: string): Promise<void> => {
		await context.addCookies([
			{ name: 'payload-tenant', value: id, url: baseURL ?? 'http://localhost:3100' },
		])
	}

	await selectTenant(admin, idOf('alpha'))
	const alphaRead = await readDocument(admin.request, alphaOffer)
	expect(alphaRead.status).toBe('ok')
	expect(alphaRead.metrics?.conversions ?? 0).toBeGreaterThanOrEqual(1)
	expect(alphaRead.metrics?.revenue ?? 0).toBeGreaterThanOrEqual(10)

	await selectTenant(admin, idOf('beta'))
	const betaRead = await readDocument(admin.request, alphaOffer)
	expect(betaRead.status).toBe('ok')
	expect(betaRead.metrics?.pageviews ?? 0).toBeGreaterThanOrEqual(1)
	expect(betaRead.metrics?.conversions).toBe(0)
	await admin.close()

	// Beta's own admin sees its goal and never alpha's, through the picker's endpoint and
	// through the collection itself.
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
