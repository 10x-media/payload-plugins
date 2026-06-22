import { describe, expect, it, vi } from 'vitest'
import { fetchFormResults } from './fetchResults'

const okResponse = (body: unknown): Response =>
	({ ok: true, status: 200, json: async () => body }) as unknown as Response

describe('fetchFormResults', () => {
	it('GETs the results endpoint and returns the aggregations', async () => {
		const fetchImpl = vi
			.fn()
			.mockResolvedValue(
				okResponse({ results: [{ field: 'colour', total: 1, truncated: false, buckets: [] }] })
			)
		const result = await fetchFormResults({ formId: 7, field: 'colour', fetchImpl })
		expect(fetchImpl).toHaveBeenCalledWith(
			'/api/forms/7/results?field=colour',
			expect.objectContaining({ method: 'GET' })
		)
		expect(result).toEqual({
			ok: true,
			results: [{ field: 'colour', total: 1, truncated: false, buckets: [] }],
		})
	})

	it('omits the query string when no field is given', async () => {
		const fetchImpl = vi.fn().mockResolvedValue(okResponse({ results: [] }))
		await fetchFormResults({ formId: 'abc', fetchImpl })
		expect(fetchImpl).toHaveBeenCalledWith('/api/forms/abc/results', expect.anything())
	})

	it('honours a custom apiRoute', async () => {
		const fetchImpl = vi.fn().mockResolvedValue(okResponse({ results: [] }))
		await fetchFormResults({ formId: 1, apiRoute: '/custom', field: 'x', fetchImpl })
		expect(fetchImpl).toHaveBeenCalledWith('/custom/forms/1/results?field=x', expect.anything())
	})

	it('returns an error result on a non-ok response', async () => {
		const fetchImpl = vi
			.fn()
			.mockResolvedValue({ ok: false, status: 403, json: async () => ({}) } as unknown as Response)
		const result = await fetchFormResults({ formId: 1, fetchImpl })
		expect(result.ok).toBe(false)
	})

	it('returns an error result when fetch throws', async () => {
		const fetchImpl = vi.fn().mockRejectedValue(new Error('offline'))
		const result = await fetchFormResults({ formId: 1, fetchImpl })
		expect(result).toEqual({ ok: false, message: 'offline' })
	})
})
