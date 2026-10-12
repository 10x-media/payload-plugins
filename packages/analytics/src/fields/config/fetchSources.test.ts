import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { QueryFetchError } from '../../ui/data/request'
import { clearSharedCaches } from '../../ui/data/sharedCache'
import { fetchSources } from './fetchSources'

const ENDPOINT = 'http://x/api/_x/sources'

const answer = (): Response => Response.json({ defaultId: null, sources: [] })

describe('fetchSources', () => {
	beforeEach(() => {
		clearSharedCaches()
		vi.stubGlobal('fetch', vi.fn())
	})

	afterEach(() => {
		vi.unstubAllGlobals()
	})

	/** Same in-flight invariant `fetchGoals` keeps; both pickers can mount twice per tick. */
	it('issues one request for concurrent calls with the same scope and URL', async () => {
		let settle: (() => void) | undefined
		vi.mocked(fetch).mockImplementation(
			() =>
				new Promise<Response>((resolve) => {
					settle = () => {
						resolve(answer())
					}
				})
		)

		const first = fetchSources(ENDPOINT, 'user-1#')
		const second = fetchSources(ENDPOINT, 'user-1#')
		expect(fetch).toHaveBeenCalledTimes(1)

		settle?.()
		await first
		await second
		expect(fetch).toHaveBeenCalledTimes(1)
	})

	it('reads again for another scope: a tenant switch is not served the last tenant list', async () => {
		vi.mocked(fetch).mockImplementation(() => Promise.resolve(answer()))

		await fetchSources(ENDPOINT, 'user-1#payload-tenant=alpha')
		await fetchSources(ENDPOINT, 'user-1#payload-tenant=beta')
		await fetchSources(ENDPOINT, 'user-2#payload-tenant=alpha')

		expect(fetch).toHaveBeenCalledTimes(3)
	})

	it('refuses an answer of another shape like a failure, and reads again later', async () => {
		vi.mocked(fetch).mockResolvedValueOnce(
			Response.json({ defaultId: null, sources: [{ id: 'native' }] })
		)
		vi.mocked(fetch).mockResolvedValueOnce(answer())

		await expect(fetchSources(ENDPOINT, 'user-shape#')).rejects.toThrow(
			'analytics: http://x/api/_x/sources answered in an unexpected shape'
		)
		await expect(fetchSources(ENDPOINT, 'user-shape#')).resolves.toEqual({
			defaultId: null,
			sources: [],
		})
	})

	it('drops the entry on failure so a later mount retries', async () => {
		vi.mocked(fetch).mockResolvedValueOnce(new Response(null, { status: 401 }))
		vi.mocked(fetch).mockResolvedValueOnce(answer())

		await expect(fetchSources(ENDPOINT, 'user-retry#')).rejects.toMatchObject({ status: 401 })
		await expect(fetchSources(ENDPOINT, 'user-retry#')).resolves.toBeTruthy()
		expect(fetch).toHaveBeenCalledTimes(2)
	})

	it('rejects with the code the endpoint answered with, so a denied listing reads as denied', async () => {
		vi.mocked(fetch).mockResolvedValueOnce(
			Response.json({ error: { code: 'forbidden', message: 'denied' } }, { status: 403 })
		)

		const refused = fetchSources(ENDPOINT, 'user-code#')
		await expect(refused).rejects.toBeInstanceOf(QueryFetchError)
		await expect(refused).rejects.toMatchObject({ status: 403, code: 'forbidden' })
	})

	it('reports a legacy string body as a plain failure rather than inventing a code', async () => {
		vi.mocked(fetch).mockResolvedValueOnce(Response.json({ error: 'forbidden' }, { status: 403 }))

		const refused = fetchSources(ENDPOINT, 'user-legacy#')
		await expect(refused).rejects.toMatchObject({ status: 403 })
		await expect(refused.catch((err: QueryFetchError) => err.code)).resolves.toBeUndefined()
	})
})
