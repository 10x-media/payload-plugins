import { inMemoryKVAdapter, type KVAdapter, type Payload } from 'payload'
import { describe, expect, it, vi } from 'vitest'
import { createEpochStore, epochKeyFor, INITIAL_EPOCH } from './epoch'

const memoryKv = (): KVAdapter => inMemoryKVAdapter().init({} as never)

const fakePayload = (kv: KVAdapter, warn: (message: string) => void = () => {}): Payload =>
	({ kv, logger: { warn } }) as unknown as Payload

describe('epochKeyFor', () => {
	it('keys a null, undefined or empty scope on the global key', () => {
		expect(epochKeyFor(null)).toBe('analytics:epoch:global')
		expect(epochKeyFor(undefined)).toBe('analytics:epoch:global')
		expect(epochKeyFor('')).toBe('analytics:epoch:global')
	})

	it('encodes a scope under its own prefix so it cannot forge another key', () => {
		expect(epochKeyFor('a:b')).toBe('analytics:epoch:s:a%3Ab')
	})

	it('keeps a scope literally named global off the install-wide key', () => {
		expect(epochKeyFor('global')).toBe('analytics:epoch:s:global')
		expect(epochKeyFor('global')).not.toBe(epochKeyFor(null))
	})

	it('gives the platform wildcard its own key', () => {
		expect(epochKeyFor('*')).not.toBe(epochKeyFor(null))
		expect(epochKeyFor('*')).not.toBe(epochKeyFor('tenant-a'))
	})
})

describe('createEpochStore', () => {
	it('answers the initial token for a scope nothing has bumped', async () => {
		const store = createEpochStore(fakePayload(memoryKv()))
		expect(await store.get('tenant-a')).toBe(INITIAL_EPOCH)
		expect(await store.get(null)).toBe(INITIAL_EPOCH)
	})

	it('answers the new token to the same instance at once', async () => {
		const store = createEpochStore(fakePayload(memoryKv()))
		expect(await store.get('tenant-a')).toBe(INITIAL_EPOCH)
		const first = await store.bump('tenant-a')
		expect(first).not.toBe(INITIAL_EPOCH)
		expect(await store.get('tenant-a')).toBe(first)
		const second = await store.bump('tenant-a')
		expect(second).not.toBe(first)
		expect(await store.get('tenant-a')).toBe(second)
	})

	// A read-modify-write counter can regress under concurrency and land back on a token
	// whose entries are still live. A fresh token per bump cannot.
	it('never reuses a token across interleaved bumps', async () => {
		const store = createEpochStore(fakePayload(memoryKv()), { now: () => 1_700_000_000_000 })
		const seen = new Set<string>()
		for (let round = 0; round < 20; round += 1) {
			const tokens = await Promise.all([
				store.bump('tenant-a'),
				store.bump('tenant-a'),
				store.bump('tenant-a'),
			])
			for (const token of tokens) {
				expect(seen.has(token)).toBe(false)
				seen.add(token)
			}
		}
		expect(seen.size).toBe(60)
	})

	it('bumps one scope without touching another', async () => {
		const store = createEpochStore(fakePayload(memoryKv()))
		const bumped = await store.bump('tenant-a')
		expect(await store.get('tenant-b')).toBe(INITIAL_EPOCH)
		expect(await store.get(null)).toBe(INITIAL_EPOCH)
		expect(await store.get('tenant-a')).toBe(bumped)
	})

	it('is visible to a second store over the same KV with a fresh memo', async () => {
		const kv = memoryKv()
		const writer = createEpochStore(fakePayload(kv))
		const reader = createEpochStore(fakePayload(kv))
		expect(await reader.get('tenant-a')).toBe(INITIAL_EPOCH)
		const bumped = await writer.bump('tenant-a')
		const fresh = createEpochStore(fakePayload(kv))
		expect(await fresh.get('tenant-a')).toBe(bumped)
	})

	it('serves the memo inside the window instead of reading KV again', async () => {
		const kv = memoryKv()
		const spy = vi.spyOn(kv, 'get')
		const store = createEpochStore(fakePayload(kv))
		await store.get('tenant-a')
		await store.get('tenant-a')
		expect(spy).toHaveBeenCalledTimes(1)
	})

	it('reads KV again once the memo window has passed', async () => {
		const kv = memoryKv()
		const spy = vi.spyOn(kv, 'get')
		let clock = 0
		const store = createEpochStore(fakePayload(kv), { memoMs: 10_000, now: () => clock })
		expect(await store.get('tenant-a')).toBe(INITIAL_EPOCH)
		clock = 9_999
		expect(await store.get('tenant-a')).toBe(INITIAL_EPOCH)
		expect(spy).toHaveBeenCalledTimes(1)
		clock = 10_001
		expect(await store.get('tenant-a')).toBe(INITIAL_EPOCH)
		expect(spy).toHaveBeenCalledTimes(2)
	})

	it('answers the initial token and warns once when the KV get throws', async () => {
		const kv = memoryKv()
		vi.spyOn(kv, 'get').mockRejectedValue(new Error('kv down'))
		const warn = vi.fn()
		const store = createEpochStore(fakePayload(kv, warn), { memoMs: 0 })
		expect(await store.get('tenant-a')).toBe(INITIAL_EPOCH)
		expect(await store.get('tenant-b')).toBe(INITIAL_EPOCH)
		expect(warn).toHaveBeenCalledTimes(1)
	})

	it('survives a payload with no logger when the KV get throws', async () => {
		const kv = memoryKv()
		vi.spyOn(kv, 'get').mockRejectedValue(new Error('kv down'))
		const store = createEpochStore({ kv } as unknown as Payload)
		expect(await store.get('tenant-a')).toBe(INITIAL_EPOCH)
	})

	it('logs and rethrows when the KV set in bump throws', async () => {
		const kv = memoryKv()
		vi.spyOn(kv, 'set').mockRejectedValue(new Error('kv down'))
		const warn = vi.fn()
		const store = createEpochStore(fakePayload(kv, warn))
		await expect(store.bump('tenant-a')).rejects.toThrow('kv down')
		expect(warn).toHaveBeenCalledTimes(1)
	})

	it('reads a stored non-string as the initial token', async () => {
		const kv = memoryKv()
		await kv.set(epochKeyFor('tenant-a'), { value: 7 })
		const store = createEpochStore(fakePayload(kv))
		expect(await store.get('tenant-a')).toBe(INITIAL_EPOCH)
	})

	it('reads a stored empty string as the initial token', async () => {
		const kv = memoryKv()
		await kv.set(epochKeyFor('tenant-a'), { value: '' })
		const store = createEpochStore(fakePayload(kv))
		expect(await store.get('tenant-a')).toBe(INITIAL_EPOCH)
	})
})
