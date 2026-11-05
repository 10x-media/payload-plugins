import { type APIRequestContext, type BrowserContext, expect, type Page } from '@playwright/test'

const HOUR_MS = 3_600_000

export interface Credentials {
	email: string
	password: string
}

/** Users the dev app seeds: the platform admin, and one user of each tenant when tenancy is on. */
export const PLATFORM: Credentials = { email: 'dev@10xmedia.de', password: 'password' }
export const ALPHA: Credentials = { email: 'alpha@10xmedia.de', password: 'password' }
export const BETA: Credentials = { email: 'beta@10xmedia.de', password: 'password' }

/**
 * Signs `request` in; a page's `page.request` shares the page's cookies. The session cookie is
 * host-bound, so a page browsing a tenant host signs in on that `origin`.
 */
export const login = async (
	request: APIRequestContext,
	credentials: Credentials = PLATFORM,
	origin = ''
): Promise<void> => {
	const res = await request.post(`${origin}/api/users/login`, { data: credentials })
	expect(res.ok(), `login as ${credentials.email}`).toBeTruthy()
}

/**
 * The multi-tenant provider auto-selects a tenant user's one tenant on mount and refreshes;
 * reloading once `payload-tenant` lands avoids racing that refresh, so later reads are scoped.
 */
export const loginAsTenant = async (page: Page, credentials: Credentials): Promise<void> => {
	await login(page.request, credentials)
	await page.goto('/admin')
	await page.waitForFunction(() => document.cookie.includes('payload-tenant='))
	await page.reload()
}

/**
 * The app on `localhost`, or on a tenant's subdomain of it: Chromium resolves every `*.localhost`
 * name to loopback, so a tenant host needs no DNS or hosts-file setup.
 */
export const localOrigin = (baseURL: string | undefined, subdomain?: string): string => {
	const { port } = new URL(baseURL ?? 'http://localhost:3100')
	return `http://${subdomain ? `${subdomain}.` : ''}localhost:${port}`
}

/** A seeded tenant's id, looked up as `request`'s user can see the tenants. */
export const tenantId = async (
	request: APIRequestContext,
	slug: string,
	origin = ''
): Promise<string> => {
	const res = await request.get(`${origin}/api/tenants?depth=0&limit=10`)
	expect(res.ok()).toBeTruthy()
	const { docs } = (await res.json()) as { docs: Array<{ id: string | number; slug: string }> }
	const id = docs.find((tenant) => tenant.slug === slug)?.id
	expect(id, `tenant "${slug}" seeded`).toBeDefined()
	return String(id)
}

/** Selects a tenant the way the admin's tenant selector does: its client-set cookie. */
export const setTenantCookie = async (
	context: BrowserContext,
	id: string,
	url: string
): Promise<void> => {
	await context.addCookies([{ name: 'payload-tenant', value: id, url }])
}

/** A seeded page's id by its slug. */
export const docIdBySlug = async (request: APIRequestContext, slug: string): Promise<string> => {
	const res = await request.get(`/api/pages?where[slug][equals]=${slug}&depth=0&limit=1`)
	expect(res.ok(), `lookup page "${slug}"`).toBeTruthy()
	const { docs } = (await res.json()) as { docs: Array<{ id: string | number }> }
	const id = docs[0]?.id
	expect(id, `page "${slug}" seeded`).toBeDefined()
	return String(id)
}

/** Settles once the tracker's next beacon has been answered. */
export const ingested = (page: Page): Promise<unknown> =>
	page.waitForResponse(
		(res) => res.url().includes('/api/_x/e') && res.request().method() === 'POST'
	)

export const search = (page: Page): Promise<string> => page.evaluate(() => window.location.search)

/** Retires every cached read, so the next read asks its source again. */
export const refreshReads = async (request: APIRequestContext): Promise<void> => {
	const res = await request.post('/api/_x/refresh', { data: {} })
	expect(res.ok(), 'refresh cached reads').toBeTruthy()
}

export interface DocumentRead {
	status: string
	metrics?: { pageviews?: number; conversions?: number; revenue?: number }
}

/** The document endpoint's `metrics` (comma-separated) for one `pages` document. */
export const readDocument = async (
	request: APIRequestContext,
	id: string,
	metrics: string
): Promise<DocumentRead> => {
	const res = await request.get(`/api/_x/document?collection=pages&id=${id}&metrics=${metrics}`)
	expect(res.ok(), 'document analytics read').toBeTruthy()
	return (await res.json()) as DocumentRead
}

/**
 * Native totals of one path over the last hour and the next. `granularity=hour` reads raw hits, so
 * nothing waits on a day's aggregation; the explicit source pins native whatever the scope's
 * registry defaults to.
 */
export const nativeTotals = async (
	request: APIRequestContext,
	params: { metrics: string; path: string; hostname?: string }
): Promise<Record<string, number | null | undefined>> => {
	const query = new URLSearchParams({
		source: 'native',
		metrics: params.metrics,
		granularity: 'hour',
		from: new Date(Date.now() - HOUR_MS).toISOString(),
		to: new Date(Date.now() + HOUR_MS).toISOString(),
		path: params.path,
		...(params.hostname ? { hostname: params.hostname } : {}),
	})
	const res = await request.get(`/api/_x/query?${query.toString()}`)
	expect(res.ok(), `query ${query.toString()}`).toBeTruthy()
	const { result } = (await res.json()) as {
		result: { totals: Record<string, number | null | undefined> }
	}
	return result.totals
}
