import type { PayloadRequest } from 'payload'
import { describe, expect, it, vi } from 'vitest'

import type { RealtimeEvent } from '../broker/types'
import { enrichForUser } from './enrichForUser'

const thinEvent = (overrides: Partial<RealtimeEvent> = {}): RealtimeEvent => ({
	id: 'evt-1',
	topic: 'posts',
	event: 'update',
	collection: 'posts',
	docId: 'post-1',
	operation: 'update',
	timestamp: 1,
	...overrides,
})

const reqWithFindByID = (findByID: ReturnType<typeof vi.fn>): PayloadRequest =>
	({
		user: { id: 'u1' },
		payload: { findByID },
	}) as unknown as PayloadRequest

describe('enrichForUser', () => {
	it('attaches doc when findByID returns a document', async () => {
		const doc = { id: 'post-1', title: 'hello' }
		const findByID = vi.fn(async () => doc)
		const event = thinEvent({ data: { existing: true } })

		const result = await enrichForUser({
			event,
			collection: 'posts',
			docId: 'post-1',
			req: reqWithFindByID(findByID),
		})

		expect(findByID).toHaveBeenCalledWith({
			collection: 'posts',
			id: 'post-1',
			req: expect.anything(),
			depth: 0,
			overrideAccess: false,
		})
		expect(result).toEqual({
			...event,
			data: { existing: true, doc },
		})
	})

	it('returns the original thin event when findByID returns null', async () => {
		const findByID = vi.fn(async () => null)
		const event = thinEvent()

		const result = await enrichForUser({
			event,
			collection: 'posts',
			docId: 'post-1',
			req: reqWithFindByID(findByID),
		})

		expect(result).toBe(event)
		expect(result?.data).toBeUndefined()
	})

	it('returns the original thin event when findByID throws', async () => {
		const findByID = vi.fn(async () => {
			throw new Error('access denied')
		})
		const event = thinEvent()

		const result = await enrichForUser({
			event,
			collection: 'posts',
			docId: 'post-1',
			req: reqWithFindByID(findByID),
		})

		expect(result).toBe(event)
		await expect(
			enrichForUser({
				event,
				collection: 'posts',
				docId: 'post-1',
				req: reqWithFindByID(findByID),
			})
		).resolves.toBe(event)
	})

	it('returns null when onDeny is drop and findByID misses', async () => {
		const findByID = vi.fn(async () => null)
		const result = await enrichForUser({
			event: thinEvent(),
			collection: 'posts',
			docId: 'post-1',
			req: reqWithFindByID(findByID),
			onDeny: 'drop',
		})
		expect(result).toBeNull()
	})

	it('returns null when onDeny is drop and findByID throws', async () => {
		const findByID = vi.fn(async () => {
			throw new Error('forbidden')
		})
		const result = await enrichForUser({
			event: thinEvent(),
			collection: 'posts',
			docId: 'post-1',
			req: reqWithFindByID(findByID),
			onDeny: 'drop',
		})
		expect(result).toBeNull()
	})
})
