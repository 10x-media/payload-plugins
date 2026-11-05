import { type APIRequestContext, expect, type Page, test } from '@playwright/test'
import { localOrigin, login, nativeTotals } from './helpers'

interface IngestAnswer {
	status: number
	body: string
}

/**
 * Posts from the page's origin so the request carries its real `Host`. Status and raw body come
 * back together: an accepted and a dropped event must be indistinguishable in both.
 */
const beacon = async (page: Page, event: Record<string, unknown>): Promise<IngestAnswer> =>
	await page.evaluate(async (payload) => {
		const res = await fetch('/api/_x/e', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify(payload),
		})
		return { status: res.status, body: await res.text() }
	}, event)

const pageviews = async (
	request: APIRequestContext,
	params: { path: string; hostname?: string }
): Promise<number> =>
	(await nativeTotals(request, { metrics: 'pageviews', ...params })).pageviews ?? 0

test('a beacon is stored under the request host, not the hostname its body claims', async ({
	page,
}) => {
	const path = `/forged-${Date.now()}`
	await page.goto('/')
	const answer = await beacon(page, { type: 'pageview', path, hostname: 'evil.example' })
	expect(answer.status).toBe(202)
	expect(answer.body).toBe('{"ok":true}')

	await login(page.request)
	expect(await pageviews(page.request, { path, hostname: 'evil.example' })).toBe(0)
	expect(await pageviews(page.request, { path, hostname: 'localhost' })).toBeGreaterThanOrEqual(1)
})

test('@tenancy ingest keeps a tenant host and drops an unknown one', async ({
	browser,
	baseURL,
}) => {
	const stamp = Date.now()
	const keptPath = `/ingest-kept-${stamp}`
	const droppedPath = `/ingest-dropped-${stamp}`

	const visitor = await browser.newContext()
	const visitorPage = await visitor.newPage()
	await visitorPage.goto(`${localOrigin(baseURL, 'alpha')}/`)
	const kept = await beacon(visitorPage, {
		type: 'pageview',
		path: keptPath,
		hostname: 'evil.example',
	})
	// Plain localhost is the host that resolves no tenant.
	await visitorPage.goto(`${localOrigin(baseURL)}/`)
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
	await login(admin.request)
	// No payload-tenant cookie, so the platform admin's read spans every scope: the dropped
	// beacon is absent from all of them, not merely from the tenant it claimed.
	expect(
		await pageviews(admin.request, { path: keptPath, hostname: 'alpha.localhost' })
	).toBeGreaterThanOrEqual(1)
	expect(await pageviews(admin.request, { path: droppedPath })).toBe(0)
	await admin.close()
})
