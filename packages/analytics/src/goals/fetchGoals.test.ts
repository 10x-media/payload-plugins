import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { QueryFetchError } from '../ui/data/request'
import { clearSharedCaches } from '../ui/data/sharedCache'
import { fetchGoals } from './fetchGoals'

const ENDPOINT = 'http://x/api/_x/goals'

const answer = (goals: Array<{ slug: string; name: string; source: 'config' | 'collection' }>) =>
	Response.json({ collection: null, goals })

describe('fetchGoals', () => {
	beforeEach(() => {
		clearSharedCaches()
		vi.stubGlobal('fetch', vi.fn())
	})

	afterEach(() => {
		vi.unstubAllGlobals()
	})

	/**
	 * StrictMode and several goal fields ask for one URL repeatedly in a tick: only caching the
	 * in-flight promise, not just settled answers, keeps that to one request.
	 */
	it('issues one request for concurrent calls with the same scope and URL', async () => {
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

		const first = fetchGoals(ENDPOINT, 'user-in-flight#')
		const second = fetchGoals(ENDPOINT, 'user-in-flight#')
		expect(fetch).toHaveBeenCalledTimes(1)

		settle?.()
		expect((await first).goals).toEqual(goals)
		expect((await second).goals).toEqual(goals)
		expect(fetch).toHaveBeenCalledTimes(1)
	})

	it('serves a later call from the settled answer', async () => {
		vi.mocked(fetch).mockImplementation(() => Promise.resolve(answer([])))

		await fetchGoals(ENDPOINT, 'user-settled#')
		await fetchGoals(ENDPOINT, 'user-settled#')

		expect(fetch).toHaveBeenCalledTimes(1)
	})

	it("keeps one user, and one tenant, out of another's entry", async () => {
		vi.mocked(fetch).mockImplementation(() => Promise.resolve(answer([])))

		await fetchGoals(ENDPOINT, 'user-a#')
		await fetchGoals(ENDPOINT, 'user-b#')
		await fetchGoals(ENDPOINT, 'user-b#payload-tenant=beta')

		expect(fetch).toHaveBeenCalledTimes(3)
	})

	it('refuses an answer of another shape like a failure', async () => {
		vi.mocked(fetch).mockResolvedValueOnce(Response.json({ goals: [{ slug: 'x' }] }))

		await expect(fetchGoals(ENDPOINT, 'user-shape#')).rejects.toThrow(/unexpected shape/)
	})

	it('drops the entry on failure so a later mount retries', async () => {
		vi.mocked(fetch).mockResolvedValueOnce(new Response(null, { status: 401 }))
		vi.mocked(fetch).mockResolvedValueOnce(answer([]))

		await expect(fetchGoals(ENDPOINT, 'user-retry#')).rejects.toMatchObject({ status: 401 })
		await expect(fetchGoals(ENDPOINT, 'user-retry#')).resolves.toBeTruthy()
		expect(fetch).toHaveBeenCalledTimes(2)
	})

	it('rejects with the code the endpoint answered with', async () => {
		vi.mocked(fetch).mockResolvedValueOnce(
			Response.json({ error: { code: 'forbidden', message: 'denied' } }, { status: 403 })
		)

		const refused = fetchGoals(ENDPOINT, 'user-code#')
		await expect(refused).rejects.toBeInstanceOf(QueryFetchError)
		await expect(refused).rejects.toMatchObject({ status: 403, code: 'forbidden' })
	})

	it('reports a legacy string body as a plain failure rather than inventing a code', async () => {
		vi.mocked(fetch).mockResolvedValueOnce(Response.json({ error: 'forbidden' }, { status: 403 }))

		const refused = fetchGoals(ENDPOINT, 'user-legacy#')
		await expect(refused).rejects.toMatchObject({ status: 403 })
		await expect(refused.catch((err: QueryFetchError) => err.code)).resolves.toBeUndefined()
	})
})
