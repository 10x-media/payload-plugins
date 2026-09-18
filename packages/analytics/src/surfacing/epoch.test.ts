import { inMemoryKVAdapter, type KVAdapter, type Payload } from 'payload'
import { describe, expect, it, vi } from 'vitest'
import { createEpochStore, epochKeyFor } from './epoch'

const memoryKv = (): KVAdapter => inMemoryKVAdapter().init({} as never)

const fakePayload = (kv: KVAdapter, warn: (message: string) => void = () => {}): Payload =>
	({ kv, logger: { warn } }) as unknown as Payload

describe('epochKeyFor', () => {
	it('keys a null, undefined or empty scope on the global segment', () => {
		expect(epochKeyFor(null)).toBe('analytics:epoch:global')
		expect(epochKeyFor(undefined)).toBe('analytics:epoch:global')
		expect(epochKeyFor('')).toBe('analytics:epoch:global')
	})

	it('encodes a scope so it cannot forge another segment', () => {
		expect(epochKeyFor('a:b')).toBe('analytics:epoch:a%3Ab')
	})

	it('gives the platform wildcard its own counter', () => {
		expect(epochKeyFor('*')).not.toBe(epochKeyFor(null))
		expect(epochKeyFor('*')).not.toBe(epochKeyFor('tenant-a'))
	})
})

describe('createEpochStore', () => {
	it('answers 0 for a scope nothing has bumped', async () => {
		const store = createEpochStore(fakePayload(memoryKv()))
		expect(await store.get('tenant-a')).toBe(0)
		expect(await store.get(null)).toBe(0)
	})

	it('increments on bump and answers the new value to the same instance at once', async () => {
		const store = createEpochStore(fakePayload(memoryKv()))
		expect(await store.get('tenant-a')).toBe(0)
		expect(await store.bump('tenant-a')).toBe(1)
		expect(await store.get('tenant-a')).toBe(1)
		expect(await store.bump('tenant-a')).toBe(2)
		expect(await store.get('tenant-a')).toBe(2)
	})

	it('bumps one scope without touching another', async () => {
		const store = createEpochStore(fakePayload(memoryKv()))
		await store.bump('tenant-a')
		expect(await store.get('tenant-b')).toBe(0)
		expect(await store.get(null)).toBe(0)
		expect(await store.get('tenant-a')).toBe(1)
	})

	it('is visible to a second store over the same KV with a fresh memo', async () => {
		const kv = memoryKv()
		const writer = createEpochStore(fakePayload(kv))
		const reader = createEpochStore(fakePayload(kv))
		expect(await reader.get('tenant-a')).toBe(0)
		await writer.bump('tenant-a')
		const fresh = createEpochStore(fakePayload(kv))
		expect(await fresh.get('tenant-a')).toBe(1)
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
		expect(await store.get('tenant-a')).toBe(0)
		clock = 9_999
		expect(await store.get('tenant-a')).toBe(0)
		expect(spy).toHaveBeenCalledTimes(1)
		clock = 10_001
		expect(await store.get('tenant-a')).toBe(0)
		expect(spy).toHaveBeenCalledTimes(2)
	})

	it('answers 0 and warns once when the KV get throws', async () => {
		const kv = memoryKv()
		vi.spyOn(kv, 'get').mockRejectedValue(new Error('kv down'))
		const warn = vi.fn()
		const store = createEpochStore(fakePayload(kv, warn), { memoMs: 0 })
		expect(await store.get('tenant-a')).toBe(0)
		expect(await store.get('tenant-b')).toBe(0)
		expect(warn).toHaveBeenCalledTimes(1)
	})

	it('logs and rethrows when the KV set in bump throws', async () => {
		const kv = memoryKv()
		const err = new Error('kv down')
		vi.spyOn(kv, 'set').mockRejectedValue(err)
		const warn = vi.fn()
		const store = createEpochStore(fakePayload(kv, warn))
		await expect(store.bump('tenant-a')).rejects.toThrow('kv down')
		expect(warn).toHaveBeenCalledTimes(1)
	})

	it('treats a corrupt stored value as 0 rather than producing NaN keys', async () => {
		const kv = memoryKv()
		await kv.set(epochKeyFor('tenant-a'), { value: 'nope' })
		const store = createEpochStore(fakePayload(kv))
		expect(await store.get('tenant-a')).toBe(0)
		expect(await store.bump('tenant-a')).toBe(1)
	})
})
