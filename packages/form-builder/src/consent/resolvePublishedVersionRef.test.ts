import { describe, expect, it, vi } from 'vitest'
import { resolvePublishedVersionRef } from './resolvePublishedVersionRef'

const makePayload = (findVersions: ReturnType<typeof vi.fn>) => ({ findVersions }) as never

describe('resolvePublishedVersionRef', () => {
	it('returns versionId and updatedAt for the newest published version', async () => {
		const findVersions = vi.fn().mockResolvedValue({
			docs: [{ id: 'v-abc', updatedAt: '2024-01-01T00:00:00.000Z' }],
		})
		const result = await resolvePublishedVersionRef(makePayload(findVersions), {
			collection: 'pages',
			id: 'doc-1',
		})
		expect(result).toEqual({ versionId: 'v-abc', updatedAt: '2024-01-01T00:00:00.000Z' })
	})

	it('passes the correct query to findVersions', async () => {
		const findVersions = vi.fn().mockResolvedValue({ docs: [] })
		await resolvePublishedVersionRef(makePayload(findVersions), {
			collection: 'policies',
			id: 42,
		})
		expect(findVersions).toHaveBeenCalledWith({
			collection: 'policies',
			where: {
				and: [{ parent: { equals: 42 } }, { 'version._status': { equals: 'published' } }],
			},
			sort: '-updatedAt',
			limit: 1,
			depth: 0,
		})
	})

	it('returns null when docs array is empty', async () => {
		const findVersions = vi.fn().mockResolvedValue({ docs: [] })
		const result = await resolvePublishedVersionRef(makePayload(findVersions), {
			collection: 'pages',
			id: 'doc-1',
		})
		expect(result).toBeNull()
	})

	it('returns null when result has no docs property', async () => {
		const findVersions = vi.fn().mockResolvedValue({})
		const result = await resolvePublishedVersionRef(makePayload(findVersions), {
			collection: 'pages',
			id: 'doc-1',
		})
		expect(result).toBeNull()
	})

	it('returns null when findVersions throws', async () => {
		const findVersions = vi.fn().mockRejectedValue(new Error('collection not versioned'))
		const result = await resolvePublishedVersionRef(makePayload(findVersions), {
			collection: 'non-versioned',
			id: 'doc-1',
		})
		expect(result).toBeNull()
	})

	it('coerces numeric id to string in return value', async () => {
		const findVersions = vi.fn().mockResolvedValue({
			docs: [{ id: 99, updatedAt: '2024-06-01T12:00:00.000Z' }],
		})
		const result = await resolvePublishedVersionRef(makePayload(findVersions), {
			collection: 'pages',
			id: 'doc-1',
		})
		expect(result).toEqual({ versionId: '99', updatedAt: '2024-06-01T12:00:00.000Z' })
	})
})
