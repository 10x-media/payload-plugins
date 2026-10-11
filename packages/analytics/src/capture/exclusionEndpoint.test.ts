import type { Payload, PayloadRequest } from 'payload'
import { describe, expect, it, vi } from 'vitest'
import { allCrossScope } from '../core/options'
import { createRegistry } from '../core/registry'
import { type AnalyticsRuntime, setRuntime } from '../plugin/runtime'
import { memoryAdapter } from '../testing/memoryAdapter'
import type { ExclusionResponse } from '../view/exclusionLink'
import { makeExclusionHandler } from './exclusionEndpoint'
import { exclusionToken } from './exclusionToken'

const SECRET = 'payload-secret'

type ErrorBody = { error: { code: string; param?: string } }

const runtimeWith = (overrides: Partial<AnalyticsRuntime> = {}): AnalyticsRuntime => ({
	registry: createRegistry([memoryAdapter()]),
	configAdapterIds: new Set(['memory']),
	bindings: {},
	readAccess: () => true,
	engine: { read: async (adapter, query) => adapter.query(query, {}) },
	ttl: {},
	comparison: true,
	exclusion: { param: 'analytics_exclude' },
	...overrides,
})

/** A tenant install: the admin call site selects by header, a visit by host. */
const scopedRuntime = (overrides: Partial<AnalyticsRuntime> = {}): AnalyticsRuntime =>
	runtimeWith({
		scoped: true,
		resolveScope: async (req, callSite) =>
			callSite === 'admin'
				? (req.headers.get('x-tenant') ?? null)
				: (req.headers.get('host')?.split('.')[0] ?? null),
		member: ({ scope }) => scope !== 'tenant-b',
		...overrides,
	})

const reqWith = (
	runtime: AnalyticsRuntime | null,
	init: { user?: unknown; headers?: Record<string, string>; search?: string } = {}
): PayloadRequest => {
	const payload = { logger: { warn: vi.fn() }, secret: SECRET } as unknown as Payload
	if (runtime) setRuntime(payload, runtime)
	return {
		user: 'user' in init ? init.user : { id: 1, collection: 'users' },
		payload,
		headers: new Headers(init.headers ?? {}),
		url: `http://admin.example/api/_x/exclusion${init.search ?? ''}`,
	} as unknown as PayloadRequest
}

const handler = makeExclusionHandler()

const codeOf = async (res: Response): Promise<string> =>
	((await res.json()) as ErrorBody).error.code

describe('makeExclusionHandler', () => {
	it('answers the install-wide token on an unscoped install, uncached', async () => {
		const res = await handler(reqWith(runtimeWith()))
		expect(res.status).toBe(200)
		expect(res.headers.get('Cache-Control')).toBe('private, no-store')
		expect((await res.json()) as ExclusionResponse).toEqual({
			param: 'analytics_exclude',
			token: exclusionToken(SECRET, null),
			sameOrigin: null,
			sites: [],
		})
	})

	it("answers the scope's own site addresses, asked with the resolved scope, each checked", async () => {
		const sites = vi.fn(async ({ scope }: { scope: string | null }) => [
			`https://${scope}.example.com`,
			`https://${scope}.example.com/`,
			'https://shop.example.com/de?x=1',
			'not an address',
			'javascript:alert(1)',
		])
		const res = await handler(
			reqWith(scopedRuntime({ exclusion: { param: 'analytics_exclude', sites } }), {
				headers: { 'x-tenant': 'tenant-a', host: 'admin.example' },
			})
		)
		expect(sites).toHaveBeenCalledWith(expect.objectContaining({ scope: 'tenant-a' }))
		expect(((await res.json()) as ExclusionResponse).sites).toEqual([
			'https://tenant-a.example.com/',
			'https://shop.example.com/de',
		])
	})

	it('still answers the token when the sites resolver throws, logging it', async () => {
		const req = reqWith(
			runtimeWith({
				exclusion: {
					param: 'analytics_exclude',
					sites: () => {
						throw new Error('lookup failed')
					},
				},
			})
		)
		const res = await handler(req)
		expect(res.status).toBe(200)
		const body = (await res.json()) as ExclusionResponse
		expect(body.sites).toEqual([])
		expect(body.token).toBe(exclusionToken(SECRET, null))
		expect(req.payload.logger.warn).toHaveBeenCalledWith(expect.stringContaining('lookup failed'))
	})

	it("answers a tenant's own token to a member of that tenant", async () => {
		const res = await handler(
			reqWith(scopedRuntime(), { headers: { 'x-tenant': 'tenant-a', host: 'admin.example' } })
		)
		expect(res.status).toBe(200)
		const body = (await res.json()) as ExclusionResponse
		expect(body.token).toBe(exclusionToken(SECRET, 'tenant-a'))
		expect(body.sameOrigin).toBe(false)
	})

	it("offers the switch on an admin served from the tenant's own site", async () => {
		const res = await handler(
			reqWith(scopedRuntime(), { headers: { 'x-tenant': 'tenant-a', host: 'tenant-a.example' } })
		)
		expect(((await res.json()) as ExclusionResponse).sameOrigin).toBe(true)
	})

	it('401s an anonymous request', async () => {
		expect((await handler(reqWith(runtimeWith(), { user: null }))).status).toBe(401)
	})

	it('404s while the link is off', async () => {
		const res = await handler(reqWith(runtimeWith({ exclusion: undefined })))
		expect(res.status).toBe(404)
		expect(await codeOf(res)).toBe('not_found')
	})

	it('403s a reader access.read denies, and one access.view denies', async () => {
		for (const overrides of [{ readAccess: () => false }, { viewAccess: () => false }]) {
			const res = await handler(reqWith(runtimeWith(overrides)))
			expect(res.status).toBe(403)
			expect(await codeOf(res)).toBe('forbidden')
		}
	})

	it('refuses a selected tenant the user does not belong to', async () => {
		const res = await handler(reqWith(scopedRuntime(), { headers: { 'x-tenant': 'tenant-b' } }))
		expect(res.status).toBe(400)
		expect(await codeOf(res)).toBe('untrusted_scope')
	})

	it('refuses a member naming another tenant, and lets a crossScope reader name it', async () => {
		const foreign = await handler(
			reqWith(scopedRuntime(), { headers: { 'x-tenant': 'tenant-a' }, search: '?scope=tenant-c' })
		)
		expect(foreign.status).toBe(400)
		expect(await codeOf(foreign)).toBe('untrusted_scope')

		const platform = await handler(
			reqWith(scopedRuntime({ crossScope: allCrossScope(() => true) }), {
				headers: { 'x-tenant': 'tenant-a' },
				search: '?scope=tenant-c',
			})
		)
		expect(platform.status).toBe(200)
		expect(((await platform.json()) as ExclusionResponse).token).toBe(
			exclusionToken(SECRET, 'tenant-c')
		)
	})

	it('refuses the wildcard, since a link belongs to one site', async () => {
		const res = await handler(
			reqWith(scopedRuntime({ crossScope: allCrossScope(() => true) }), {
				headers: { 'x-tenant': 'tenant-a' },
				search: '?scope=*',
			})
		)
		expect(res.status).toBe(400)
		expect(await codeOf(res)).toBe('invalid_param')
	})
})
