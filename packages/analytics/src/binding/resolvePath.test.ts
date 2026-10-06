import type { PayloadRequest } from 'payload'
import { describe, expect, it, vi } from 'vitest'
import { hostnameFromBinding, resolveHostname, resolvePath, resolvePathCached } from './resolvePath'
import type { AnalyticsBinding } from './types'

const ctx = () => ({ req: { context: {} } as unknown as PayloadRequest, locale: undefined })

describe('resolvePath', () => {
	it('awaits a sync resolver result', async () => {
		const binding: AnalyticsBinding = { path: (d) => (d.slug ? `/${d.slug as string}` : null) }
		expect(await resolvePath(binding, { slug: 'about' }, ctx())).toBe('/about')
	})
	it('awaits an async resolver result', async () => {
		const binding: AnalyticsBinding = { path: async (d) => `/${d.slug as string}` }
		expect(await resolvePath(binding, { slug: 'x' }, ctx())).toBe('/x')
	})
	it('falls back to pathField when the resolver yields null', async () => {
		const binding: AnalyticsBinding = { path: () => null, pathField: 'pathname' }
		expect(await resolvePath(binding, { pathname: '/p' }, ctx())).toBe('/p')
	})
	it('returns null when nothing resolves', async () => {
		expect(await resolvePath({ pathField: 'pathname' }, {}, ctx())).toBeNull()
	})
})

describe('resolveHostname', () => {
	it('passes a static hostname through', async () => {
		expect(await resolveHostname({ hostname: 'example.com' }, {}, ctx())).toBe('example.com')
	})
	it('supports a sync one-argument resolver', async () => {
		const binding: AnalyticsBinding = { hostname: (d) => d.domain as string }
		expect(await resolveHostname(binding, { domain: 'a.com' }, ctx())).toBe('a.com')
	})
	it('awaits an async resolver and hands it the binding context', async () => {
		const binding: AnalyticsBinding = {
			hostname: async (d, c) => (c.req ? (d.domain as string) : null),
		}
		expect(await resolveHostname(binding, { domain: 'b.com' }, ctx())).toBe('b.com')
	})
	it('maps a null or empty resolver result to undefined (no hostname filter)', async () => {
		expect(await resolveHostname({ hostname: () => null }, {}, ctx())).toBeUndefined()
		expect(await resolveHostname({ hostname: () => '' }, {}, ctx())).toBeUndefined()
	})
	it('returns undefined when the binding has no hostname', async () => {
		expect(await resolveHostname({}, {}, ctx())).toBeUndefined()
	})
	it('spells a URL-ish hostname the way the stored events do', async () => {
		expect(await resolveHostname({ hostname: 'https://Example.com:443/' }, {}, ctx())).toBe(
			'example.com'
		)
		expect(await resolveHostname({ hostname: () => 'Example.com' }, {}, ctx())).toBe('example.com')
	})
})

describe('hostnameFromBinding', () => {
	it('takes the host out of a URL and normalizes it', () => {
		expect(hostnameFromBinding('https://Example.com:443/')).toBe('example.com')
		expect(hostnameFromBinding('http://a.example/path?q=1')).toBe('a.example')
	})
	it('normalizes a bare hostname', () => {
		expect(hostnameFromBinding('Example.com')).toBe('example.com')
		expect(hostnameFromBinding('a.example:3000')).toBe('a.example')
	})
	it('keeps anything that is no hostname exactly as it was', () => {
		for (const raw of ['tenant 7', 'https://', 'ä.example', '://broken']) {
			expect(hostnameFromBinding(raw), raw).toBe(raw)
		}
	})
})

describe('resolvePathCached', () => {
	it('invokes the resolver once per (doc, req)', async () => {
		const path = vi.fn(async () => '/cached')
		const binding: AnalyticsBinding = { path }
		const doc = { id: 1 }
		const c = ctx()
		const a = resolvePathCached(binding, doc, c)
		const b = resolvePathCached(binding, doc, c)
		expect(await a).toBe('/cached')
		expect(await b).toBe('/cached')
		expect(path).toHaveBeenCalledTimes(1)
	})
	it('resolves directly when the request has no context bag', async () => {
		const binding: AnalyticsBinding = { path: (d) => `/${d.slug as string}` }
		const noCtx = { req: {} as unknown as PayloadRequest, locale: undefined }
		expect(await resolvePathCached(binding, { slug: 'x' }, noCtx)).toBe('/x')
	})
})
