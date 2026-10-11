import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
	clearSharedCaches,
	createSharedCache,
	MAX_SHARED_SCOPES,
	requestScopeKey,
} from './sharedCache'

const cache = createSharedCache<string>()

beforeEach(() => {
	clearSharedCaches()
})

describe('createSharedCache', () => {
	it('loads once per route, scope and path, and shares the promise while it runs', async () => {
		const load = vi.fn(() => Promise.resolve('sources'))
		const key = { route: '/api/_x/sources', scope: 'u1#payload-tenant=alpha' }

		const first = cache.read(key, load)
		const second = cache.read(key, load)

		expect(second).toBe(first)
		await expect(second).resolves.toBe('sources')
		await cache.read(key, load)
		expect(load).toHaveBeenCalledTimes(1)
	})

	it('keeps one scope out of another: a tenant switch reads its own answer', async () => {
		const load = vi.fn((answer: string) => () => Promise.resolve(answer))

		await expect(
			cache.read({ route: '/api/_x/goals', scope: 'u1#payload-tenant=alpha' }, load('alpha'))
		).resolves.toBe('alpha')
		await expect(
			cache.read({ route: '/api/_x/goals', scope: 'u1#payload-tenant=beta' }, load('beta'))
		).resolves.toBe('beta')
		await expect(
			cache.read({ route: '/api/_x/goals', scope: 'u1#payload-tenant=alpha' }, load('stale'))
		).resolves.toBe('alpha')
	})

	it('keeps routes and paths apart', async () => {
		const load = vi.fn(() => Promise.resolve('x'))
		await cache.read({ route: '/a', scope: 's' }, load)
		await cache.read({ route: '/b', scope: 's' }, load)
		await cache.read({ route: '/a', scope: 's', path: 'page:visitors:native' }, load)
		await cache.read({ route: '/a', scope: 's', path: 'page:visitors:posthog' }, load)
		expect(load).toHaveBeenCalledTimes(4)
	})

	it('drops a failed load so the next caller tries again', async () => {
		const key = { route: '/api/_x/sources', scope: 's' }
		await expect(cache.read(key, () => Promise.reject(new Error('down')))).rejects.toThrow('down')
		await expect(cache.read(key, () => Promise.resolve('back'))).resolves.toBe('back')
	})

	// Every cookie churn or tenant switch is a new scope; a long session must not keep them all.
	it('keeps the most recently read scopes only, forgetting the oldest first', async () => {
		const load = vi.fn(() => Promise.resolve('x'))
		const scopes = Array.from({ length: MAX_SHARED_SCOPES + 1 }, (_, i) => `u1@scope-${i}`)
		for (const scope of scopes) {
			await cache.read({ route: '/api/_x/sources', scope }, load)
		}
		expect(load).toHaveBeenCalledTimes(MAX_SHARED_SCOPES + 1)

		// The newest are still held; the first one read was forgotten and is read again.
		await cache.read({ route: '/api/_x/sources', scope: scopes.at(-1) ?? '' }, load)
		expect(load).toHaveBeenCalledTimes(MAX_SHARED_SCOPES + 1)
		await cache.read({ route: '/api/_x/sources', scope: scopes[0] ?? '' }, load)
		expect(load).toHaveBeenCalledTimes(MAX_SHARED_SCOPES + 2)
	})

	it('forgets every answer when cleared', async () => {
		const key = { route: '/api/_x/sources', scope: 's' }
		await cache.read(key, () => Promise.resolve('first'))
		clearSharedCaches()
		await expect(cache.read(key, () => Promise.resolve('second'))).resolves.toBe('second')
	})
})

describe('requestScopeKey', () => {
	it('names the user and the cookies a host selector sets, in a stable order', () => {
		expect(requestScopeKey('u1', 'payload-tenant=alpha; payload-theme=dark')).toBe(
			requestScopeKey('u1', 'payload-theme=dark;payload-tenant=alpha')
		)
		expect(requestScopeKey('u1', 'payload-tenant=alpha')).not.toBe(
			requestScopeKey('u1', 'payload-tenant=beta')
		)
		expect(requestScopeKey('u1', 'payload-tenant=alpha')).not.toBe(
			requestScopeKey('u2', 'payload-tenant=alpha')
		)
	})

	it("ignores Next's own development cookies, which change on every refresh", () => {
		expect(requestScopeKey('u1', '__next_hmr_refresh_hash__=4; payload-tenant=alpha')).toBe(
			requestScopeKey('u1', 'payload-tenant=alpha; __next_hmr_refresh_hash__=9')
		)
	})
})
