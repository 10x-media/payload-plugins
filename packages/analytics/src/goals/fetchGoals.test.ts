import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fetchGoals } from './fetchGoals'

const answer = (goals: Array<{ slug: string; name: string; source: 'config' | 'collection' }>) =>
	({ ok: true, json: async () => ({ collection: null, goals }) }) as unknown as Response

describe('fetchGoals', () => {
	beforeEach(() => {
		vi.stubGlobal('fetch', vi.fn())
	})

	afterEach(() => {
		vi.unstubAllGlobals()
	})

	/**
	 * React's strict mode runs every effect twice, and a document can carry several goal
	 * fields, so the same user's picker asks for the same URL more than once in one tick.
	 * The in-flight promise is what dedupes those; a cache that only stored settled answers
	 * would let both calls hit the network.
	 */
	it('issues one request for concurrent calls with the same user and URL', async () => {
		const goals = [{ slug: 'newsletter', name: 'Newsletter', source: 'collection' as const }]
		let settle: (() => void) | undefined
		vi.mocked(fetch).mockImplementation(
			() =>
				new Promise<Response>((resolve) => {
					settle = () => {
						resolve(answer(goals))
					}
				})
		)

		const first = fetchGoals('http://x', '/api', 'user-in-flight')
		const second = fetchGoals('http://x', '/api', 'user-in-flight')
		expect(fetch).toHaveBeenCalledTimes(1)

		settle?.()
		expect((await first).goals).toEqual(goals)
		expect((await second).goals).toEqual(goals)
		expect(fetch).toHaveBeenCalledTimes(1)
	})

	it('serves a later call from the settled answer', async () => {
		vi.mocked(fetch).mockResolvedValue(answer([]))

		await fetchGoals('http://x', '/api', 'user-settled')
		await fetchGoals('http://x', '/api', 'user-settled')

		expect(fetch).toHaveBeenCalledTimes(1)
	})

	it('keeps one user out of another user cache entry', async () => {
		vi.mocked(fetch).mockResolvedValue(answer([]))

		await fetchGoals('http://x', '/api', 'user-a')
		await fetchGoals('http://x', '/api', 'user-b')

		expect(fetch).toHaveBeenCalledTimes(2)
	})

	it('drops the entry on failure so a later mount retries', async () => {
		vi.mocked(fetch).mockResolvedValueOnce({ ok: false, status: 401 } as Response)
		vi.mocked(fetch).mockResolvedValueOnce(answer([]))

		await expect(fetchGoals('http://x', '/api', 'user-retry')).rejects.toThrow('goals 401')
		await expect(fetchGoals('http://x', '/api', 'user-retry')).resolves.toBeTruthy()
		expect(fetch).toHaveBeenCalledTimes(2)
	})
})
