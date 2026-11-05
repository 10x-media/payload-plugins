import type { Payload, PayloadRequest } from 'payload'
import { describe, expect, it, vi } from 'vitest'
import { posthog } from '../adapters/posthog/posthog'
import type { FetchLike } from '../core/fetch'
import { createRegistry } from '../core/registry'
import { type AnalyticsRuntime, setRuntime } from '../plugin/runtime'
import { makeProxyHandler } from './proxyEndpoint'

const AGENT = 'Mozilla/5.0 (Macintosh) Safari/605.1.15'

/**
 * PostHog behind the runtime proxy, its upstream recorded. Cookieless counting hashes the address
 * and agent PostHog receives, so both must be the visitor's, resolved by the install's trust.
 */
const proxied = (
	trust: Pick<AnalyticsRuntime, 'trustedProxyHops' | 'trustedPlatform'>,
	host?: string
) => {
	const fetch = vi.fn<FetchLike>(async () => Response.json({}))
	const adapter = posthog({
		projectId: '1',
		apiKey: 'phx_private',
		projectToken: 'phc_public',
		fetch,
		...(host ? { host } : {}),
	})
	const payload = { logger: { warn: vi.fn() }, config: {} } as unknown as Payload
	setRuntime(payload, {
		registry: createRegistry([adapter]),
		configAdapterIds: new Set([adapter.id]),
		bindings: {},
		engine: {} as AnalyticsRuntime['engine'],
		ttl: {},
		comparison: true,
		...trust,
	})
	const send = async (path: string, init: { method: string; headers: Record<string, string> }) => {
		const req = Object.assign(
			new Request(`https://site.test/api/_x/p/global${path}`, {
				method: init.method,
				headers: init.headers,
				...(init.method === 'POST' ? { body: '{"batch":[]}' } : {}),
			}),
			{ payload, routeParams: { slot: 'global' } }
		) as unknown as PayloadRequest
		const res = await makeProxyHandler('/_x/p')(req)
		expect(res.status).toBe(200)
		const call = fetch.mock.calls.at(-1)
		return { url: String(call?.[0]), headers: new Headers(call?.[1]?.headers) }
	}
	return { send }
}

const ROUTES = [
	{ path: '/flags/?v=2', method: 'POST' },
	{ path: '/e/', method: 'POST' },
	{ path: '/i/v0/e/', method: 'POST' },
	{ path: '/flags/?v=2', method: 'GET' },
]

describe('capture proxy, PostHog routes', () => {
	it("forwards the visitor's agent and the address trustedProxyHops resolves", async () => {
		for (const host of [undefined, 'https://posthog.self.test']) {
			const { send } = proxied({ trustedProxyHops: 1 }, host)
			for (const { path, method } of ROUTES) {
				const upstream = await send(path, {
					method,
					headers: {
						'user-agent': AGENT,
						'x-forwarded-for': '198.51.100.1, 203.0.113.7',
						'content-type': 'application/json',
					},
				})
				expect(upstream.url, `${host ?? 'cloud'} ${path}`).toContain(path.split('?')[0])
				expect(upstream.headers.get('user-agent')).toBe(AGENT)
				expect(upstream.headers.get('x-forwarded-for')).toBe('203.0.113.7')
			}
		}
	})

	it("forwards the platform's own client address under trustedPlatform, never the visitor's claim", async () => {
		const { send } = proxied({ trustedPlatform: 'vercel' })
		for (const { path, method } of ROUTES) {
			const upstream = await send(path, {
				method,
				headers: {
					'user-agent': AGENT,
					'x-real-ip': '203.0.113.9',
					'x-forwarded-for': '198.51.100.1',
				},
			})
			expect(upstream.headers.get('user-agent')).toBe(AGENT)
			expect(upstream.headers.get('x-forwarded-for')).toBe('203.0.113.9')
			expect(upstream.headers.get('x-real-ip')).toBeNull()
		}
	})
})
