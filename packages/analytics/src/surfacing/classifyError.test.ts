import { describe, expect, it } from 'vitest'
import { ProviderHttpError } from '../adapters/http/fetchJson'
import {
	HostRefusedError,
	InvalidQueryError,
	SourceMisconfiguredError,
	UnsupportedFilterError,
} from '../core/sourceErrors'
import { ReadTimeoutError } from '../native/store/rawRead'
import { BREAKER_MAX_MS } from './breaker'
import {
	classifyError,
	grpcCodeKind,
	httpStatusKind,
	LaneRefusedError,
	PROVIDER_READ_TIMEOUT_MESSAGE,
	ReadFailedError,
	readFailureOf,
	ScopeBusyError,
} from './classifyError'

/** A google-gax style error: GA4's client rejects with the gRPC status as a numeric `code`. */
const grpcError = (code: number): Error => Object.assign(new Error(`grpc ${code}`), { code })

describe('httpStatusKind', () => {
	it.each([
		[400, 'invalid_param'],
		[413, 'invalid_param'],
		[414, 'invalid_param'],
		[422, 'invalid_param'],
		[431, 'invalid_param'],
		[401, 'source_misconfigured'],
		[402, 'source_misconfigured'],
		[403, 'source_misconfigured'],
		[404, 'source_misconfigured'],
		[408, 'unavailable'],
		[429, 'unavailable'],
		[500, 'unavailable'],
		[502, 'unavailable'],
		[503, 'unavailable'],
		[504, 'unavailable'],
	] as const)('reads HTTP %i as %s', (status, kind) => {
		expect(httpStatusKind(status)).toBe(kind)
		expect(classifyError(new ProviderHttpError(status, 'x', 'x')).kind).toBe(kind)
	})
})

describe('grpcCodeKind', () => {
	it.each([
		[3, 'invalid_param'],
		[5, 'source_misconfigured'],
		[7, 'source_misconfigured'],
		[16, 'source_misconfigured'],
		[4, 'unavailable'],
		[8, 'unavailable'],
		[13, 'unavailable'],
		[14, 'unavailable'],
		[2, 'unavailable'],
	] as const)('reads gRPC %i as %s', (code, kind) => {
		expect(grpcCodeKind(code)).toBe(kind)
		expect(classifyError(grpcError(code)).kind).toBe(kind)
	})

	it('marks a deadline or a cancel as a timeout, which is not worth retrying at once', () => {
		expect(classifyError(grpcError(4))).toEqual({ kind: 'unavailable', timeout: true })
		expect(classifyError(grpcError(1))).toEqual({ kind: 'unavailable', timeout: true })
		expect(classifyError(grpcError(14)).timeout).toBeUndefined()
	})

	it('marks a spent quota, which a retry a moment later only spends again', () => {
		expect(classifyError(grpcError(8))).toEqual({ kind: 'unavailable', quota: true })
		expect(classifyError(grpcError(14)).quota).toBeUndefined()
	})
})

describe('classifyError', () => {
	it("carries the vendor's Retry-After", () => {
		expect(
			classifyError(new ProviderHttpError(429, 'x', { message: 'slow down', retryAfterMs: 5000 }))
		).toEqual({ kind: 'unavailable', retryAfterMs: 5000 })
	})

	it('caps a vendor’s Retry-After at the breaker’s longest wait', () => {
		expect(
			classifyError(
				new ProviderHttpError(503, 'x', { message: 'come back tomorrow', retryAfterMs: 86_400_000 })
			)
		).toEqual({ kind: 'unavailable', retryAfterMs: BREAKER_MAX_MS })
		expect(
			classifyError(Object.assign(grpcError(14), { retryAfterMs: BREAKER_MAX_MS * 10 }))
		).toEqual({ kind: 'unavailable', retryAfterMs: BREAKER_MAX_MS })
	})

	it('reads a refused host as misconfigured, and says it was the host', () => {
		expect(classifyError(new HostRefusedError('https://a.test', 'unlisted'))).toEqual({
			kind: 'source_misconfigured',
			hostRefused: true,
		})
		expect(classifyError(new SourceMisconfiguredError('bad key'))).toEqual({
			kind: 'source_misconfigured',
		})
	})

	it('reads a credential that would not decrypt as misconfigured', () => {
		const err = Object.assign(new Error('no key'), { name: 'DecryptFailedError' })
		expect(classifyError(err).kind).toBe('source_misconfigured')
	})

	it("reads the plugin's own refusals as invalid_param naming the parameter", () => {
		expect(
			classifyError(new UnsupportedFilterError('x', { dimension: 'page', operator: 'matches' }))
		).toMatchObject({ kind: 'invalid_param', param: 'filters' })
		expect(classifyError(new InvalidQueryError('no items here', 'item'))).toEqual({
			kind: 'invalid_param',
			param: 'item',
			message: 'no items here',
		})
	})

	it('reads timeouts and aborts as a timed-out outage', () => {
		expect(classifyError(new Error(PROVIDER_READ_TIMEOUT_MESSAGE))).toEqual({
			kind: 'unavailable',
			timeout: true,
		})
		const abort = new DOMException('aborted', 'AbortError')
		expect(classifyError(abort).timeout).toBe(true)
		expect(
			classifyError(Object.assign(new Error('slow'), { name: 'ReadTimeoutError' })).timeout
		).toBe(true)
	})

	it('marks a native read refused before it ran, which reads as busy', () => {
		const refused = new ReadTimeoutError('sqlite', 150, { refused: true })
		expect(classifyError(refused)).toEqual({ kind: 'unavailable', timeout: true, refused: true })
		expect(readFailureOf(refused).status).toBe('busy')
		expect(classifyError(new ReadTimeoutError('sqlite', 150))).toEqual({
			kind: 'unavailable',
			timeout: true,
		})
	})

	it('reads a lane refusal and a busy scope with how long to wait', () => {
		expect(classifyError(new LaneRefusedError('open', 30_000))).toEqual({
			kind: 'unavailable',
			retryAfterMs: 30_000,
		})
		expect(
			classifyError(new LaneRefusedError('open', 30_000, { kind: 'unavailable', retryAfterMs: 1 }))
		).toEqual({ kind: 'unavailable', retryAfterMs: 30_000 })
		// A breaker a refused key or host opened keeps saying so while it rests.
		expect(
			classifyError(
				new LaneRefusedError('open', 30_000, { kind: 'source_misconfigured', hostRefused: true })
			)
		).toEqual({ kind: 'source_misconfigured', hostRefused: true, retryAfterMs: 30_000 })
		expect(classifyError(new ScopeBusyError(2000))).toEqual({
			kind: 'rate_limited',
			retryAfterMs: 2000,
		})
	})

	it('finds the signal down the cause chain', () => {
		const wrapped = new Error('outer', {
			cause: new Error('middle', { cause: new ProviderHttpError(403, 'x', 'x') }),
		})
		expect(classifyError(wrapped).kind).toBe('source_misconfigured')
	})

	it('answers a classified failure as classified, its cause still reachable', () => {
		const cause = new HostRefusedError('https://a.test', 'private')
		const failed = new ReadFailedError({ kind: 'source_misconfigured', hostRefused: true }, cause)
		expect(classifyError(failed)).toEqual({ kind: 'source_misconfigured', hostRefused: true })
		expect(failed.message).toContain(cause.message)
	})

	it("reads Mongo's refused patterns and inputs as the query's fault, never as gRPC codes", () => {
		const mongo = (code: number, message = 'x') =>
			Object.assign(new Error(message), {
				name: 'MongoServerError',
				code,
				codeName: `Location${code}`,
			})
		expect(
			classifyError(mongo(51091, 'Regular expression is invalid: missing terminating ]'))
		).toMatchObject({ kind: 'invalid_param', param: 'filters' })
		expect(classifyError(mongo(51108)).kind).toBe('invalid_param')
		expect(classifyError(mongo(51111)).kind).toBe('invalid_param')
		expect(classifyError(mongo(2)).kind).toBe('invalid_param')
		expect(classifyError(mongo(50))).toEqual({ kind: 'unavailable', timeout: true })
		expect(classifyError(mongo(13)).kind).toBe('source_misconfigured')
		expect(classifyError(mongo(6))).toEqual({ kind: 'unavailable' })
		expect(classifyError(mongo(11600))).toEqual({ kind: 'unavailable' })
	})

	it('reads Postgres SQLSTATEs: bad patterns and statements refused, setup misconfigured, the rest an outage', () => {
		const pg = (code: string) =>
			Object.assign(new Error(`pg ${code}`), { name: 'error', code, severity: 'ERROR' })
		const wrapped = new Error('Failed query', { cause: pg('2201B') })
		expect(classifyError(wrapped)).toMatchObject({ kind: 'invalid_param', param: 'filters' })
		expect(classifyError(pg('42601')).kind).toBe('invalid_param')
		expect(classifyError(pg('22P02')).kind).toBe('invalid_param')
		expect(classifyError(pg('54001')).kind).toBe('invalid_param')
		expect(classifyError(pg('42P01')).kind).toBe('source_misconfigured')
		expect(classifyError(pg('42501')).kind).toBe('source_misconfigured')
		expect(classifyError(pg('57014'))).toEqual({ kind: 'unavailable', timeout: true })
		expect(classifyError(pg('08006'))).toEqual({ kind: 'unavailable' })
		expect(classifyError(pg('40P01'))).toEqual({ kind: 'unavailable' })
	})

	it('reads libsql codes, as a worker thread hands them back too', () => {
		const sqlite = (code: string, message = 'x') => Object.assign(new Error(message), { code })
		expect(classifyError(sqlite('SQLITE_ERROR', 'near "(": syntax error')).kind).toBe(
			'invalid_param'
		)
		expect(classifyError(sqlite('SQLITE_ERROR', 'no such table: analytics_hits')).kind).toBe(
			'source_misconfigured'
		)
		expect(classifyError(sqlite('SQLITE_TOOBIG')).kind).toBe('invalid_param')
		expect(classifyError(sqlite('SQLITE_BUSY'))).toEqual({ kind: 'unavailable' })
		expect(classifyError(sqlite('SQLITE_IOERR_READ'))).toEqual({ kind: 'unavailable' })
		expect(classifyError(sqlite('SQLITE_INTERRUPT'))).toEqual({
			kind: 'unavailable',
			timeout: true,
		})
	})

	it('presumes anything else a network outage', () => {
		expect(classifyError(new TypeError('fetch failed'))).toEqual({ kind: 'unavailable' })
		expect(classifyError(Object.assign(new Error('reset'), { code: 'ECONNRESET' }))).toEqual({
			kind: 'unavailable',
		})
		expect(classifyError('a string')).toEqual({ kind: 'unavailable' })
	})
})

describe('readFailureOf', () => {
	it('names a refused host, any other setup failure, a refused query, and a busy source', () => {
		expect(readFailureOf(new HostRefusedError('https://a.test', 'unlisted'))).toEqual({
			status: 'host-refused',
		})
		expect(readFailureOf(new ProviderHttpError(401, 'x', 'x'))).toEqual({ status: 'misconfigured' })
		expect(readFailureOf(new ProviderHttpError(400, 'x', 'x'))).toEqual({ status: 'invalid' })
		expect(readFailureOf(new ProviderHttpError(503, 'x', 'x'))).toEqual({ status: 'busy' })
	})

	it('says how long a busy source asked to be left alone', () => {
		expect(
			readFailureOf(new ProviderHttpError(429, 'x', { message: 'slow down', retryAfterMs: 7000 }))
		).toEqual({ status: 'busy', retryAfterMs: 7000 })
		expect(readFailureOf(new ScopeBusyError(2000))).toEqual({ status: 'busy', retryAfterMs: 2000 })
		expect(readFailureOf(new Error(PROVIDER_READ_TIMEOUT_MESSAGE))).toEqual({ status: 'busy' })
	})
})
