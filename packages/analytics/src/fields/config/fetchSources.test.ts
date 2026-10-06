import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fetchSources } from './fetchSources'

const answer = () =>
	({ ok: true, json: async () => ({ defaultId: null, sources: [] }) }) as unknown as Response

describe('fetchSources', () => {
	beforeEach(() => {
		vi.stubGlobal('fetch', vi.fn())
	})

	afterEach(() => {
		vi.unstubAllGlobals()
	})

	/** Same in-flight invariant `fetchGoals` keeps; both pickers can mount twice per tick. */
	it('issues one request for concurrent calls with the same user and URL', async () => {
		let settle: (() => void) | undefined
		vi.mocked(fetch).mockImplementation(
			() =>
				new Promise<Response>((resolve) => {
					settle = () => {
						resolve(answer())
					}
				})
		)

		const first = fetchSources('http://x', '/api', 'user-in-flight')
		const second = fetchSources('http://x', '/api', 'user-in-flight')
		expect(fetch).toHaveBeenCalledTimes(1)

		settle?.()
		await first
		await second
		expect(fetch).toHaveBeenCalledTimes(1)
	})

	it('drops the entry on failure so a later mount retries', async () => {
		vi.mocked(fetch).mockResolvedValueOnce({ ok: false, status: 401 } as Response)
		vi.mocked(fetch).mockResolvedValueOnce(answer())

		await expect(fetchSources('http://x', '/api', 'user-retry')).rejects.toThrow('sources 401')
		await expect(fetchSources('http://x', '/api', 'user-retry')).resolves.toBeTruthy()
		expect(fetch).toHaveBeenCalledTimes(2)
	})

	it('carries the code the endpoint answered with, so a denied listing reads as denied', async () => {
		vi.mocked(fetch).mockResolvedValueOnce({
			ok: false,
			status: 403,
			json: () => Promise.resolve({ error: { code: 'forbidden', message: 'denied' } }),
		} as unknown as Response)

		await expect(fetchSources('http://x', '/api', 'user-code')).rejects.toMatchObject({
			message: 'analytics: sources 403 forbidden',
		})
	})

	it('reports a legacy string body as a plain failure rather than inventing a code', async () => {
		vi.mocked(fetch).mockResolvedValueOnce({
			ok: false,
			status: 403,
			json: () => Promise.resolve({ error: 'forbidden' }),
		} as unknown as Response)

		await expect(fetchSources('http://x', '/api', 'user-legacy')).rejects.toMatchObject({
			message: 'analytics: sources 403',
		})
	})
})
