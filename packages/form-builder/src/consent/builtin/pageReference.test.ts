import { describe, expect, it, vi } from 'vitest'
import { pageReferenceSource } from './pageReference'

const makePayload = (
	findByIDResult: unknown,
	findVersionsResult?: unknown
): Record<string, unknown> => ({
	findByID: vi.fn().mockResolvedValue(findByIDResult),
	findVersions: vi.fn().mockResolvedValue(findVersionsResult ?? { docs: [] }),
})

const locale = 'en'

describe('pageReferenceSource', () => {
	it('has type "pageReference"', () => {
		expect(pageReferenceSource.type).toBe('pageReference')
	})

	it('returns empty links when relationTo is missing', async () => {
		const payload = makePayload({})
		const result = await pageReferenceSource.resolve({
			config: { docId: 'doc-1' },
			payload: payload as never,
			locale,
		})
		expect(result).toEqual({ links: [] })
		expect(payload.findByID).not.toHaveBeenCalled()
	})

	it('returns empty links when docId is missing', async () => {
		const payload = makePayload({})
		const result = await pageReferenceSource.resolve({
			config: { relationTo: 'pages' },
			payload: payload as never,
			locale,
		})
		expect(result).toEqual({ links: [] })
		expect(payload.findByID).not.toHaveBeenCalled()
	})

	it('returns placeholder link when doc is not found', async () => {
		const payload = makePayload(null)
		const result = await pageReferenceSource.resolve({
			config: { relationTo: 'pages', docId: 'missing' },
			payload: payload as never,
			locale,
		})
		expect(result).toEqual({ links: [{ label: 'pages', url: '' }] })
	})

	it('returns placeholder link when findByID rejects', async () => {
		const payload = {
			findByID: vi.fn().mockRejectedValue(new Error('not found')),
			findVersions: vi.fn().mockResolvedValue({ docs: [] }),
		}
		const result = await pageReferenceSource.resolve({
			config: { relationTo: 'pages', docId: 'bad' },
			payload: payload as never,
			locale,
		})
		expect(result).toEqual({ links: [{ label: 'pages', url: '' }] })
	})

	it('builds link with title and slug', async () => {
		const payload = makePayload({ id: 'p1', title: 'Privacy Policy', slug: '/privacy' })
		const result = await pageReferenceSource.resolve({
			config: { relationTo: 'pages', docId: 'p1' },
			payload: payload as never,
			locale,
		})
		expect(result).toEqual({ links: [{ label: 'Privacy Policy', url: '/privacy' }] })
	})

	it('falls back to urlField value for label when title is absent', async () => {
		const payload = makePayload({ id: 'p1', slug: '/terms' })
		const result = await pageReferenceSource.resolve({
			config: { relationTo: 'pages', docId: 'p1' },
			payload: payload as never,
			locale,
		})
		expect(result).toEqual({ links: [{ label: '/terms', url: '/terms' }] })
	})

	it('uses a custom urlField when specified', async () => {
		const payload = makePayload({ id: 'p1', title: 'Terms', permalink: '/terms-of-use' })
		const result = await pageReferenceSource.resolve({
			config: { relationTo: 'pages', docId: 'p1', urlField: 'permalink' },
			payload: payload as never,
			locale,
		})
		expect(result).toEqual({ links: [{ label: 'Terms', url: '/terms-of-use' }] })
	})

	it('falls back to relationTo for label when title and urlField are both absent', async () => {
		const payload = makePayload({ id: 'p1' })
		const result = await pageReferenceSource.resolve({
			config: { relationTo: 'pages', docId: 'p1' },
			payload: payload as never,
			locale,
		})
		expect(result).toEqual({ links: [{ label: 'pages', url: '' }] })
	})

	it('does not include version fields when captureVersion is false', async () => {
		const payload = makePayload({ id: 'p1', title: 'Privacy', slug: '/privacy' })
		const result = await pageReferenceSource.resolve({
			config: { relationTo: 'pages', docId: 'p1', captureVersion: false },
			payload: payload as never,
			locale,
		})
		expect(result).not.toHaveProperty('versionRef')
		expect(result).not.toHaveProperty('versionLabel')
		expect(payload.findVersions).not.toHaveBeenCalled()
	})

	it('adds versionRef and versionLabel when captureVersion is true and a version exists', async () => {
		const payload = makePayload(
			{ id: 'p1', title: 'Privacy', slug: '/privacy' },
			{ docs: [{ id: 'v-abc', updatedAt: '2024-01-01T00:00:00.000Z' }] }
		)
		const result = await pageReferenceSource.resolve({
			config: { relationTo: 'pages', docId: 'p1', captureVersion: true },
			payload: payload as never,
			locale,
		})
		expect(result).toEqual({
			links: [{ label: 'Privacy', url: '/privacy' }],
			versionRef: 'v-abc',
			versionLabel: '2024-01-01T00:00:00.000Z',
		})
	})

	it('omits version fields when captureVersion is true but no published version exists', async () => {
		const payload = makePayload({ id: 'p1', title: 'Privacy', slug: '/privacy' }, { docs: [] })
		const result = await pageReferenceSource.resolve({
			config: { relationTo: 'pages', docId: 'p1', captureVersion: true },
			payload: payload as never,
			locale,
		})
		expect(result).toEqual({ links: [{ label: 'Privacy', url: '/privacy' }] })
		expect(result).not.toHaveProperty('versionRef')
	})

	it('omits version fields when captureVersion is true but findVersions throws', async () => {
		const payload = {
			findByID: vi.fn().mockResolvedValue({ id: 'p1', title: 'Privacy', slug: '/privacy' }),
			findVersions: vi.fn().mockRejectedValue(new Error('not versioned')),
		}
		const result = await pageReferenceSource.resolve({
			config: { relationTo: 'pages', docId: 'p1', captureVersion: true },
			payload: payload as never,
			locale,
		})
		expect(result).toEqual({ links: [{ label: 'Privacy', url: '/privacy' }] })
		expect(result).not.toHaveProperty('versionRef')
	})
})
