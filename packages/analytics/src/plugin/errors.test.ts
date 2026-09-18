import { describe, expect, it } from 'vitest'
import type { QueryError, QueryErrorCode } from '../query/errors'
import { queryError } from '../query/errors'
import {
	type AnalyticsError,
	type AnalyticsErrorCode,
	analyticsError,
	errorResponse,
	NO_STORE,
	RETRY_AFTER,
	readError,
	readErrorCode,
} from './errors'

describe('analyticsError', () => {
	it('builds a coded error and omits param entirely when none is given', () => {
		const error = analyticsError('forbidden', 'analytics: read access denied')
		expect(error).toEqual({ code: 'forbidden', message: 'analytics: read access denied' })
		expect('param' in error).toBe(false)
	})

	it('carries the parameter at fault when one is named', () => {
		expect(analyticsError('invalid_param', 'analytics: bad range', 'from')).toEqual({
			code: 'invalid_param',
			message: 'analytics: bad range',
			param: 'from',
		})
	})
})

describe('errorResponse', () => {
	it('answers the envelope under the given status, uncacheable', async () => {
		const res = errorResponse(403, analyticsError('forbidden', 'nope'))
		expect(res.status).toBe(403)
		expect(res.headers.get('cache-control')).toBe('private, no-store')
		expect(await res.json()).toEqual({ error: { code: 'forbidden', message: 'nope' } })
	})

	it('merges extra headers over the no-store default', () => {
		const res = errorResponse(503, analyticsError('unavailable', 'down'), RETRY_AFTER)
		expect(res.headers.get('retry-after')).toBe('30')
		expect(res.headers.get('cache-control')).toBe('private, no-store')
	})

	it('exposes the no-store header the read endpoints share', () => {
		expect(NO_STORE).toEqual({ 'Cache-Control': 'private, no-store' })
	})
})

describe('readErrorCode', () => {
	it('reads the code out of the envelope', () => {
		expect(readErrorCode({ error: { code: 'unauthorized', message: 'nope' } })).toBe('unauthorized')
	})

	it('reads nothing from the legacy string body the other endpoints used to send', () => {
		expect(readErrorCode({ error: 'forbidden' })).toBeUndefined()
	})

	it('reads nothing from a code no release of this package ever sent', () => {
		expect(readErrorCode({ error: { code: 'teapot', message: 'nope' } })).toBeUndefined()
	})

	it('reads nothing from garbage', () => {
		expect(readErrorCode(undefined)).toBeUndefined()
		expect(readErrorCode(null)).toBeUndefined()
		expect(readErrorCode('forbidden')).toBeUndefined()
		expect(readErrorCode(7)).toBeUndefined()
		expect(readErrorCode([])).toBeUndefined()
		expect(readErrorCode({})).toBeUndefined()
		expect(readErrorCode({ error: {} })).toBeUndefined()
		expect(readErrorCode({ error: { code: 'forbidden' } })).toBeUndefined()
		expect(readErrorCode({ error: { code: 7, message: 'nope' } })).toBeUndefined()
	})

	it('reads every code the package declares', () => {
		const codes: AnalyticsErrorCode[] = ['not_found', 'payload_too_large', 'internal']
		for (const code of codes) {
			expect(readErrorCode({ error: { code, message: 'x' } })).toBe(code)
		}
	})
})

describe('readError', () => {
	it('keeps the message and the parameter at fault', () => {
		expect(readError({ error: { code: 'invalid_param', message: 'bad', param: 'to' } })).toEqual({
			code: 'invalid_param',
			message: 'bad',
			param: 'to',
		})
	})

	it('drops a param that is not a string rather than refusing the whole body', () => {
		const error = readError({ error: { code: 'invalid_param', message: 'bad', param: 7 } })
		expect(error).toEqual({ code: 'invalid_param', message: 'bad' })
	})

	it('reads what errorResponse wrote', async () => {
		const res = errorResponse(400, analyticsError('untrusted_scope', 'no', 'scope'))
		expect(readError(await res.json())).toEqual({
			code: 'untrusted_scope',
			message: 'no',
			param: 'scope',
		})
	})
})

describe('the query aliases', () => {
	it('keeps queryError building the same object under the old name', () => {
		const code: QueryErrorCode = 'unknown_source'
		const built: QueryError = queryError(code, 'analytics: unknown source', 'source')
		const same: AnalyticsError = analyticsError(code, 'analytics: unknown source', 'source')
		expect(built).toEqual(same)
	})
})
