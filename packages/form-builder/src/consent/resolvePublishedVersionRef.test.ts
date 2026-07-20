import type { PayloadRequest } from 'payload'
import { describe, expect, it, vi } from 'vitest'
import { resolvePublishedVersionRef } from './resolvePublishedVersionRef'

const makePayload = (findVersions: ReturnType<typeof vi.fn>) => ({ findVersions }) as never

describe('resolvePublishedVersionRef', () => {
	it('returns the newest published version document id', async () => {
		const findVersions = vi.fn().mockResolvedValue({
			docs: [{ id: 'v-abc', updatedAt: '2024-01-01T00:00:00.000Z' }],
		})
		const result = await resolvePublishedVersionRef({
			payload: makePayload(findVersions),
			collection: 'pages',
			id: 'doc-1',
		})
		expect(result).toBe('v-abc')
	})

	it('threads req into findVersions so a version written in the same transaction is visible', async () => {
		const findVersions = vi.fn().mockResolvedValue({ docs: [] })
		const req = { transactionID: 'tx-1' } as unknown as PayloadRequest
		await resolvePublishedVersionRef({
			payload: makePayload(findVersions),
			collection: 'policies',
			id: 42,
			req,
		})
		expect(findVersions).toHaveBeenCalledWith({
			collection: 'policies',
			where: {
				and: [{ parent: { equals: 42 } }, { 'version._status': { equals: 'published' } }],
			},
			sort: '-updatedAt',
			limit: 1,
			depth: 0,
			req,
		})
	})

	it('returns null when nothing is published', async () => {
		const findVersions = vi.fn().mockResolvedValue({ docs: [] })
		expect(
			await resolvePublishedVersionRef({
				payload: makePayload(findVersions),
				collection: 'pages',
				id: 'doc-1',
			})
		).toBeNull()
	})

	it('returns null when result has no docs property', async () => {
		const findVersions = vi.fn().mockResolvedValue({})
		expect(
			await resolvePublishedVersionRef({
				payload: makePayload(findVersions),
				collection: 'pages',
				id: 'doc-1',
			})
		).toBeNull()
	})

	it('returns null when findVersions throws', async () => {
		const findVersions = vi.fn().mockRejectedValue(new Error('collection not versioned'))
		expect(
			await resolvePublishedVersionRef({
				payload: makePayload(findVersions),
				collection: 'non-versioned',
				id: 'doc-1',
			})
		).toBeNull()
	})

	it('coerces a numeric version id to a string', async () => {
		const findVersions = vi.fn().mockResolvedValue({ docs: [{ id: 99 }] })
		expect(
			await resolvePublishedVersionRef({
				payload: makePayload(findVersions),
				collection: 'pages',
				id: 'doc-1',
			})
		).toBe('99')
	})
})
