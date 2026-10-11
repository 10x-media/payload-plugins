import { describe, expect, it } from 'vitest'
import { ProviderHttpError } from '../adapters/http/fetchJson'
import { HostRefusedError, InvalidQueryError } from '../core/sourceErrors'
import { ReadFailedError } from '../surfacing/classifyError'
import { readError } from './errors'
import { HOST_REFUSED_MESSAGE, readFailureResponse } from './readFailure'

const answered = async (err: unknown) => {
	const res = readFailureResponse(err)
	return {
		status: res.status,
		retryAfter: res.headers.get('Retry-After'),
		cacheControl: res.headers.get('Cache-Control'),
		error: readError(await res.json()),
	}
}

describe('readFailureResponse', () => {
	it("answers a query the vendor refused 400, blaming the query, never the vendor's text", async () => {
		const res = await answered(new ProviderHttpError(400, 'ga4', 'ga4: HTTP 400 secret detail'))
		expect(res).toEqual({
			status: 400,
			retryAfter: null,
			cacheControl: 'private, no-store',
			error: {
				code: 'invalid_param',
				message: 'analytics: the source refused this query as asked',
				param: 'query',
			},
		})
	})

	it("answers the plugin's own refusal 400 with the parameter at fault", async () => {
		const res = await answered(new InvalidQueryError('analytics: no items here', 'item'))
		expect(res.status).toBe(400)
		expect(res.error).toEqual({
			code: 'invalid_param',
			message: 'analytics: no items here',
			param: 'item',
		})
	})

	it('answers a source refused as set up 502 with no Retry-After, naming the host when that is why', async () => {
		const key = await answered(
			new ReadFailedError({ kind: 'source_misconfigured' }, new ProviderHttpError(401, 'x', 'x'))
		)
		expect(key).toMatchObject({
			status: 502,
			retryAfter: null,
			error: { code: 'source_misconfigured', param: 'source' },
		})
		const host = await answered(new HostRefusedError('https://stats.internal', 'unlisted'))
		expect(host).toMatchObject({
			status: 502,
			retryAfter: null,
			error: { code: 'source_misconfigured', param: 'host', message: HOST_REFUSED_MESSAGE },
		})
		expect(host.error?.message).not.toContain('stats.internal')
	})

	it("answers an outage 503 with the lane's Retry-After, rounded up to whole seconds", async () => {
		expect(
			await answered(new ReadFailedError({ kind: 'unavailable', retryAfterMs: 29_001 }))
		).toMatchObject({ status: 503, retryAfter: '30', error: { code: 'unavailable' } })
		expect(
			await answered(new ReadFailedError({ kind: 'unavailable', retryAfterMs: 120 }))
		).toMatchObject({ status: 503, retryAfter: '1' })
		expect(await answered(new TypeError('fetch failed'))).toMatchObject({
			status: 503,
			retryAfter: '30',
		})
	})

	it('answers a scope with too many cold reads waiting 429 with a Retry-After', async () => {
		expect(
			await answered(new ReadFailedError({ kind: 'rate_limited', retryAfterMs: 2000 }))
		).toMatchObject({ status: 429, retryAfter: '2', error: { code: 'rate_limited' } })
	})
})
