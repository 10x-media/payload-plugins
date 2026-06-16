import type { PayloadRequest } from 'payload'
import { describe, expect, it } from 'vitest'
import { buildPayload } from './buildPayload'

const req = {} as PayloadRequest
const base = {
	deliveryId: 'd1',
	collection: 'posts',
	doc: { id: 'p1', title: 'Hi', secret: 'x' },
	occurredAt: '2026-06-05T00:00:00.000Z',
	req,
}

describe('buildPayload', () => {
	it('defaults `data` to the full document', () => {
		const body = buildPayload({ ...base, operation: 'create' })
		expect(body).toEqual({
			id: 'd1',
			event: 'posts.created',
			collection: 'posts',
			operation: 'create',
			occurredAt: '2026-06-05T00:00:00.000Z',
			data: base.doc,
		})
	})

	it('applies a per-collection transform to `data`', () => {
		const body = buildPayload({
			...base,
			operation: 'create',
			config: { transform: ({ doc }) => ({ id: doc.id }) },
		})
		expect(body.data).toEqual({ id: 'p1' })
	})

	it('includes previousData only on update when enabled and present', () => {
		const prev = { id: 'p1', title: 'Old' }
		expect(
			buildPayload({
				...base,
				operation: 'update',
				previousDoc: prev,
				config: { includePreviousData: true },
			}).previousData
		).toEqual(prev)
		expect(
			buildPayload({ ...base, operation: 'update', previousDoc: prev }).previousData
		).toBeUndefined()
		expect(
			buildPayload({ ...base, operation: 'create', config: { includePreviousData: true } })
				.previousData
		).toBeUndefined()
	})
})
