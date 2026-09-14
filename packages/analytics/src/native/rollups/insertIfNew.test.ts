import type { Payload } from 'payload'
import { describe, expect, it } from 'vitest'
import { SEEN_SLUG } from '../collections/seen'
import { insertIfNew } from './insertIfNew'

const KEY = { bucket: 'b', kind: 'visitor', value: 'v', period: new Date('2026-01-10T00:00:00Z') }

const mongoPayload = (updateOne: () => Promise<{ upsertedCount: number }>): Payload =>
	({
		db: { name: 'mongoose', collections: { [SEEN_SLUG]: { collection: { updateOne } } } },
	}) as unknown as Payload

const pgPayload = (returning: () => Promise<unknown[]>): Payload =>
	({
		db: {
			name: 'postgres',
			drizzle: {
				insert: () => ({ values: () => ({ onConflictDoNothing: () => ({ returning }) }) }),
			},
			tables: { analytics_seen: {} },
			tableNameMap: new Map([['analytics_seen', 'analytics_seen']]),
		},
	}) as unknown as Payload

const withCode = (code: number | string): Error & { code: number | string } =>
	Object.assign(new Error('duplicate key'), { code })

describe('insertIfNew', () => {
	it('reports a fresh mongo upsert as new and a no-op upsert as seen', async () => {
		await expect(
			insertIfNew(
				mongoPayload(async () => ({ upsertedCount: 1 })),
				SEEN_SLUG,
				KEY
			)
		).resolves.toBe(true)
		await expect(
			insertIfNew(
				mongoPayload(async () => ({ upsertedCount: 0 })),
				SEEN_SLUG,
				KEY
			)
		).resolves.toBe(false)
	})

	it('treats a mongo duplicate-key error as already seen', async () => {
		const payload = mongoPayload(() => Promise.reject(withCode(11000)))
		await expect(insertIfNew(payload, SEEN_SLUG, KEY)).resolves.toBe(false)
	})

	it('rethrows any other mongo error', async () => {
		const payload = mongoPayload(() => Promise.reject(withCode(121)))
		await expect(insertIfNew(payload, SEEN_SLUG, KEY)).rejects.toThrow('duplicate key')
	})

	it('reports a fresh postgres insert as new and a conflicting one as seen', async () => {
		await expect(
			insertIfNew(
				pgPayload(async () => [{}]),
				SEEN_SLUG,
				KEY
			)
		).resolves.toBe(true)
		await expect(
			insertIfNew(
				pgPayload(async () => []),
				SEEN_SLUG,
				KEY
			)
		).resolves.toBe(false)
	})

	it('treats a postgres unique violation as already seen', async () => {
		const payload = pgPayload(() => Promise.reject(withCode('23505')))
		await expect(insertIfNew(payload, SEEN_SLUG, KEY)).resolves.toBe(false)
	})

	it('rethrows any other postgres error', async () => {
		const payload = pgPayload(() => Promise.reject(withCode('23502')))
		await expect(insertIfNew(payload, SEEN_SLUG, KEY)).rejects.toThrow('duplicate key')
	})

	it('sees through a wrapper that carries the driver error as its cause', async () => {
		const wrapped = Object.assign(new Error('Failed query'), { cause: withCode('23505') })
		const payload = pgPayload(() => Promise.reject(wrapped))
		await expect(insertIfNew(payload, SEEN_SLUG, KEY)).resolves.toBe(false)
	})
})
