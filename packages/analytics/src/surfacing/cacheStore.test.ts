import { inMemoryKVAdapter } from 'payload'
import { describe, expect, it } from 'vitest'
import { kvCacheStore } from './cacheStore'

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
})
