import { inMemoryKVAdapter } from 'payload'
import { describe, expect, it } from 'vitest'
import { kvCacheStore, STALE_WINDOW_SECONDS } from './cacheStore'

const makeKv = () => inMemoryKVAdapter().init({} as never)

describe('kvCacheStore', () => {
	it('returns a value before expiry and null after', async () => {
		const store = kvCacheStore(makeKv())
		let now = 1_000
		store.now = () => now
		await store.set('k', { hello: 'world' }, 10) // ttl seconds
		expect(await store.get('k')).toEqual({ hello: 'world' })
		now = 12_000
		expect(await store.get('k')).toBeNull()
	})

	it('returns null for an unknown key', async () => {
		expect(await kvCacheStore(makeKv()).get('missing')).toBeNull()
	})

	it('serves getStale between expiry and the stale window, not before', async () => {
		const store = kvCacheStore(makeKv())
		let now = 1_000
		store.now = () => now
		await store.set('k', { hello: 'world' }, 10)

		// still fresh: getStale withholds it, get serves it
		expect(await store.getStale('k')).toBeNull()

		now = 12_000 // past expiresAt (11_000), well within the stale window
		expect(await store.get('k')).toBeNull()
		expect(await store.getStale('k')).toEqual({ hello: 'world' })
	})

	it('deletes and stops serving stale once past staleUntil', async () => {
		const store = kvCacheStore(makeKv())
		let now = 1_000
		store.now = () => now
		await store.set('k', { hello: 'world' }, 10)

		now = 11_000 + STALE_WINDOW_SECONDS * 1000 + 1
		expect(await store.getStale('k')).toBeNull()
		expect(await store.get('k')).toBeNull()
	})

	it('never stale-serves a legacy entry written without staleUntil', async () => {
		const kv = makeKv()
		const store = kvCacheStore(kv)
		let now = 1_000
		store.now = () => now
		// Simulate a pre-release entry: no staleUntil field at all.
		await kv.set('legacy', { value: { hello: 'legacy' }, expiresAt: 11_000 })

		now = 12_000 // past expiresAt but well inside what would be the stale window
		expect(await store.get('legacy')).toBeNull()
		expect(await store.getStale('legacy')).toBeNull()
	})
})
