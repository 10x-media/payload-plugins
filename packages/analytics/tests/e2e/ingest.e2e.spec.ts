import { type APIRequestContext, expect, type Page, test } from '@playwright/test'

const PLATFORM = { email: 'dev@10xmedia.de', password: 'password' }

interface IngestAnswer {
	status: number
	body: string
}

const login = async (
	request: APIRequestContext,
	credentials: { email: string; password: string }
): Promise<void> => {
	const res = await request.post('/api/users/login', { data: credentials })
	expect(res.ok(), `login as ${credentials.email}`).toBeTruthy()
}

/**
 * Posts one beacon from the page's own origin, so the request carries that page's `Host`
 * rather than a header a Node-side client would have to fabricate. The status and the raw
 * body come back together, because an accepted and a dropped event must be indistinguishable
 * in both.
 */
const beacon = async (page: Page, event: Record<string, unknown>): Promise<IngestAnswer> =>
	await page.evaluate(async (payload) => {
		const res = await fetch('/api/analytics/ingest', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify(payload),
		})
		return { status: res.status, body: await res.text() }
	}, event)

/**
 * Pageviews the native adapter holds for one path, optionally narrowed to one stored
 * hostname. `granularity=hour` reads the raw events rather than the day rollups, so the
 * assertion does not wait on a rollup pass, and the explicit source keeps the read on the
 * native adapter whichever one the scope's registry defaults to.
 */
const pageviews = async (
	request: APIRequestContext,
	params: { path: string; hostname?: string }
): Promise<number> => {
	const query = new URLSearchParams({
		source: 'native',
		metrics: 'pageviews',
		granularity: 'hour',
		from: new Date(Date.now() - 3_600_000).toISOString(),
		to: new Date(Date.now() + 3_600_000).toISOString(),
		path: params.path,
		...(params.hostname ? { hostname: params.hostname } : {}),
	})
	const res = await request.get(`/api/analytics/query?${query.toString()}`)
	expect(res.ok(), `query ${query.toString()}`).toBeTruthy()
	const { result } = (await res.json()) as { result: { totals: { pageviews?: number } } }
	return result.totals.pageviews ?? 0
}

test('a beacon is stored under the request host, not the hostname its body claims', async ({
	page,
}) => {
	const path = `/forged-${Date.now()}`
	await page.goto('/')
	const answer = await beacon(page, { type: 'pageview', path, hostname: 'evil.example' })
	expect(answer.status).toBe(202)
	expect(answer.body).toBe('{"ok":true}')

	await login(page.request, PLATFORM)
	expect(await pageviews(page.request, { path, hostname: 'evil.example' })).toBe(0)
	expect(await pageviews(page.request, { path, hostname: 'localhost' })).toBeGreaterThanOrEqual(1)
})

test('@tenancy ingest keeps a tenant host and drops an unknown one', async ({
	browser,
	baseURL,
}) => {
	// Chromium resolves every *.localhost name to loopback, so a tenant subdomain needs no
	// DNS or hosts-file setup; plain localhost is the host that resolves no tenant.
	const port = new URL(baseURL ?? 'http://localhost:3100').port
	const stamp = Date.now()
	const keptPath = `/ingest-kept-${stamp}`
	const droppedPath = `/ingest-dropped-${stamp}`

	const visitor = await browser.newContext()
	const visitorPage = await visitor.newPage()
	await visitorPage.goto(`http://alpha.localhost:${port}/`)
	const kept = await beacon(visitorPage, {
		type: 'pageview',
		path: keptPath,
		hostname: 'evil.example',
	})
	await visitorPage.goto(`http://localhost:${port}/`)
	const dropped = await beacon(visitorPage, {
		type: 'pageview',
		path: droppedPath,
		hostname: 'alpha.localhost',
	})
	await visitor.close()

	expect(kept.status).toBe(202)
	// Same status and same body: the endpoint never tells a prober which hosts resolve a tenant.
	expect(dropped).toEqual(kept)

	const admin = await browser.newContext()
	await login(admin.request, PLATFORM)
	// No payload-tenant cookie, so the platform admin's read spans every scope: the dropped
	// beacon is absent from all of them, not merely from the tenant it claimed.
	expect(
		await pageviews(admin.request, { path: keptPath, hostname: 'alpha.localhost' })
	).toBeGreaterThanOrEqual(1)
	expect(await pageviews(admin.request, { path: droppedPath })).toBe(0)
	await admin.close()
})
