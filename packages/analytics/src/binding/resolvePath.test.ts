import type { PayloadRequest } from 'payload'
import { describe, expect, it, vi } from 'vitest'
import { resolvePath, resolvePathCached } from './resolvePath'
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
