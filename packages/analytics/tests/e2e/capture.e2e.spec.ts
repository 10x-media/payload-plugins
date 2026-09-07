import {
	type APIRequestContext,
	type BrowserContext,
	expect,
	type Page,
	test,
} from '@playwright/test'

const PLATFORM = { email: 'dev@10xmedia.de', password: 'password' }

interface DocumentRead {
	status: string
	metrics?: { pageviews?: number; conversions?: number; revenue?: number }
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

const readDocument = async (
	request: APIRequestContext,
	id: string,
	metrics: string
): Promise<DocumentRead> => {
	const res = await request.get(
		`/api/analytics/document?collection=pages&id=${id}&metrics=${metrics}`
	)
	expect(res.ok(), 'document analytics read').toBeTruthy()
	return (await res.json()) as DocumentRead
}

const ingested = (page: Page): Promise<unknown> =>
	page.waitForResponse(
		(res) => res.url().includes('/api/analytics/ingest') && res.request().method() === 'POST'
	)

/**
 * Converts twice on the home page, then leaves for `/thank-you`. The two buttons cover both
 * ways an event reaches the tracker: the CTA's `data-analytics-goal` attribute through
 * auto-capture, and a `useAnalytics().track` call from a client component with no provider
 * above it. Both go out immediately; the pageview only on the navigation's `pagehide`.
 *
 * Waiting on the ingest responses rather than polling a read is deliberate: an aggregate
 * read is cached for the adapter's TTL, so a read taken one moment too early would pin an
 * empty answer in the cache for minutes and no amount of retrying would recover it.
 */
const visitAndConvert = async (page: Page, origin = ''): Promise<void> => {
	await page.goto(`${origin}/`)
	for (const name of ['Book a demo', 'Sign up']) {
		const sent = ingested(page)
		await page.getByRole('button', { name }).click()
		await sent
	}
	const pageview = ingested(page)
	await page.goto(`${origin}/thank-you`)
	await pageview
}

test('a frontend visit and two goal clicks land as a pageview and conversions', async ({
	page,
}) => {
	await visitAndConvert(page)

	await login(page.request, PLATFORM)
	const home = await docIdBySlug(page.request, 'home')
	const read = await readDocument(page.request, home, 'pageviews,conversions')
	expect(read.status).toBe('ok')
	expect(read.metrics?.pageviews ?? 0).toBeGreaterThanOrEqual(1)
	// One per button: the attribute goal and the tracked `signup` event.
	expect(read.metrics?.conversions ?? 0).toBeGreaterThanOrEqual(2)

	const realtime = await page.request.get('/api/analytics/realtime?metric=pageviews')
	expect(realtime.ok()).toBeTruthy()
	const { activeNow } = (await realtime.json()) as { activeNow: number }
	expect(activeNow).toBeGreaterThanOrEqual(1)
})

test('@tenancy an anonymous visit is attributed to the hostname tenant', async ({
	browser,
	baseURL,
}) => {
	// Chromium resolves every *.localhost name to loopback, so the dev app's hostname
	// scope resolver sees a real tenant subdomain without any DNS or hosts-file setup.
	const port = new URL(baseURL ?? 'http://localhost:3100').port
	const visitor = await browser.newContext()
	const visitorPage = await visitor.newPage()
	await visitAndConvert(visitorPage, `http://alpha.localhost:${port}`)
	await visitor.close()

	const admin = await browser.newContext()
	await login(admin.request, PLATFORM)
	const home = await docIdBySlug(admin.request, 'home')

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

	// The platform admin reads any scope it selects, so one session can check both sides of
	// the boundary: the conversion belongs to alpha and must not appear under beta.
	const selectTenant = async (context: BrowserContext, id: string): Promise<void> => {
		await context.addCookies([
			{ name: 'payload-tenant', value: id, url: baseURL ?? 'http://localhost:3100' },
		])
	}

	await selectTenant(admin, idOf('alpha'))
	const alphaRead = await readDocument(admin.request, home, 'pageviews,conversions')
	expect(alphaRead.status).toBe('ok')
	expect(alphaRead.metrics?.conversions ?? 0).toBeGreaterThanOrEqual(2)

	// Beta has its own seeded traffic on this path, so its pageviews are the proof the read
	// reached data at all: a scope that answered with nothing would pass a bare `conversions
	// === 0` vacuously.
	await selectTenant(admin, idOf('beta'))
	const betaRead = await readDocument(admin.request, home, 'pageviews,conversions')
	expect(betaRead.status).toBe('ok')
	expect(betaRead.metrics).toBeDefined()
	expect(betaRead.metrics?.pageviews ?? 0).toBeGreaterThanOrEqual(1)
	expect(betaRead.metrics?.conversions).toBe(0)
	await admin.close()
})
