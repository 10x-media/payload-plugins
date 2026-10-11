import {
	invalidQuery,
	isHostRefused,
	isSourceMisconfigured,
	refusedFilter,
} from '../core/sourceErrors'
import { isRecord } from '../core/values'
import { BREAKER_MAX_MS } from './breaker'

/**
 * What a failed read means: `invalid_param` refused as asked (no retry, never served stale),
 * `source_misconfigured` set up wrong, `unavailable` down or slow, `rate_limited` scope full.
 */
export type ReadFailureKind =
	| 'invalid_param'
	| 'source_misconfigured'
	| 'unavailable'
	| 'rate_limited'

export interface ReadFailure {
	kind: ReadFailureKind
	/** The source's host is refused: unlisted, private, or not https. */
	hostRefused?: true
	/** The read ran out of time, so trying it again at once cannot help. */
	timeout?: true
	/** Refused as too big before it ran: the source answered, so the breaker sees an answer. */
	refused?: true
	/** The source's quota is spent, so trying it again at once cannot help either. */
	quota?: true
	/**
	 * How long until the same read can succeed, when the source or the plugin knows: never longer
	 * than the breaker's longest wait, whatever a vendor's `Retry-After` asked.
	 */
	retryAfterMs?: number
	/** The parameter at fault, set on an `invalid_param` the plugin itself raised. */
	param?: string
	/** A message safe to show, set on an `invalid_param` the plugin itself raised. */
	message?: string
}

/** Reason message the engine's own read-timeout abort uses. */
export const PROVIDER_READ_TIMEOUT_MESSAGE = 'analytics: provider read timed out'

const READ_FAILED: unique symbol = Symbol.for('@10x-media/analytics/readFailed')

const LANE_REFUSED: unique symbol = Symbol.for('@10x-media/analytics/laneRefused')

/**
 * A read that failed, already classified. The engine throws it with the source's own error as its
 * `cause`, so the cause-chain readers (`refusedFilter`, `isHostRefused`) keep working through it.
 */
export class ReadFailedError extends Error {
	readonly [READ_FAILED] = true
	readonly failure: ReadFailure

	constructor(failure: ReadFailure, cause?: unknown) {
		// The cause's own message rides along for the logs; no endpoint ever answers with it.
		super(
			`analytics: read failed (${failure.kind})${cause instanceof Error ? `: ${cause.message}` : ''}`,
			cause === undefined ? undefined : { cause }
		)
		this.name = 'ReadFailedError'
		this.failure = failure
	}
}

/**
 * A lane that would not start a request (breaker open, or `Retry-After` past the read's deadline);
 * never sent, so never a failure. `opened` lets a source rested for its setup keep saying so.
 */
export class LaneRefusedError extends Error {
	readonly [LANE_REFUSED] = true
	readonly retryAfterMs: number
	readonly reason: 'open' | 'paused'
	readonly opened?: ReadFailure

	constructor(reason: 'open' | 'paused', retryAfterMs: number, opened?: ReadFailure) {
		super(
			reason === 'open'
				? 'analytics: the source failed too often and is rested for now'
				: 'analytics: the source asked to be left alone for now'
		)
		this.name = 'LaneRefusedError'
		this.reason = reason
		this.retryAfterMs = retryAfterMs
		if (opened) {
			this.opened = opened
		}
	}
}

/** A cold read refused: its scope already has `cache.concurrency.perScope` reads waiting. */
export class ScopeBusyError extends Error {
	readonly retryAfterMs: number

	constructor(retryAfterMs: number) {
		super('analytics: this scope has too many reads waiting on their sources')
		this.name = 'ScopeBusyError'
		this.retryAfterMs = retryAfterMs
	}
}

export const isLaneRefused = (err: unknown): err is LaneRefusedError =>
	isRecord(err) && Reflect.get(err, LANE_REFUSED) === true

const isReadFailed = (err: unknown): err is ReadFailedError =>
	isRecord(err) && Reflect.get(err, READ_FAILED) === true

/**
 * Statuses that refuse the request as it was sent (bad, too large, its URI or headers too long):
 * the read is the caller's to change, and the source's setup is not at fault.
 */
const HTTP_INVALID: ReadonlySet<number> = new Set([400, 413, 414, 422, 431])

/** What an HTTP status from a vendor means for the read. */
export const httpStatusKind = (status: number): ReadFailureKind => {
	if (HTTP_INVALID.has(status)) return 'invalid_param'
	if (status === 408 || status === 429) return 'unavailable'
	if (status >= 400 && status < 500) return 'source_misconfigured'
	return 'unavailable'
}

/** gRPC status codes (GA4's Data API) that say the request itself is wrong. */
const GRPC_INVALID: ReadonlySet<number> = new Set([3])

/** NOT_FOUND, PERMISSION_DENIED, UNAUTHENTICATED: the property or the credentials are wrong. */
const GRPC_MISCONFIGURED: ReadonlySet<number> = new Set([5, 7, 16])

/** CANCELLED and DEADLINE_EXCEEDED: the call ran out of the time the read gave it. */
const GRPC_TIMEOUT: ReadonlySet<number> = new Set([1, 4])

/** RESOURCE_EXHAUSTED: the quota is spent, which a retry a second later only spends again. */
const GRPC_QUOTA = 8

/** What a gRPC status code means for the read; anything not named above is an outage. */
export const grpcCodeKind = (code: number): ReadFailureKind => {
	if (GRPC_INVALID.has(code)) return 'invalid_param'
	if (GRPC_MISCONFIGURED.has(code)) return 'source_misconfigured'
	return 'unavailable'
}

const TIMEOUT_NAMES: ReadonlySet<string> = new Set([
	'AbortError',
	'TimeoutError',
	'ReadTimeoutError',
])

const numberAt = (value: object, key: string): number | undefined => {
	const found: unknown = Reflect.get(value, key)
	return typeof found === 'number' && Number.isFinite(found) ? found : undefined
}

const textAt = (value: object, key: string): string | undefined => {
	const found: unknown = Reflect.get(value, key)
	return typeof found === 'string' ? found : undefined
}

/** What the plugin answers for a pattern the database's regex dialect refused. */
const PATTERN_REFUSED: ReadFailure = {
	kind: 'invalid_param',
	param: 'filters',
	message: "analytics: the database cannot read this filter's pattern",
}

/** A query the database refused as written: the same read fails the same way every time. */
const QUERY_REFUSED: ReadFailure = { kind: 'invalid_param' }

const DATABASE_TIMEOUT: ReadFailure = { kind: 'unavailable', timeout: true }

const DATABASE_SETUP: ReadFailure = { kind: 'source_misconfigured' }

const mentionsPattern = (message: string | undefined): boolean =>
	message !== undefined && /regular expression|\bregex/i.test(message)

/** Mongo's codes for a `$regex` or `$regexMatch` it cannot compile, and related input errors. */
const MONGO_PATTERN_CODES: ReadonlySet<number> = new Set([51091, 51092, 51108, 51111])
const MONGO_INPUT_CODES: ReadonlySet<number> = new Set([2, 9, 14, 15, 16, 10334])
const MONGO_TIMEOUT_CODES: ReadonlySet<number> = new Set([50, 262])
const MONGO_SETUP_CODES: ReadonlySet<number> = new Set([13, 18])

const mongoFailure = (code: number, message: string | undefined): ReadFailure => {
	if (MONGO_PATTERN_CODES.has(code)) return PATTERN_REFUSED
	if (MONGO_TIMEOUT_CODES.has(code)) return DATABASE_TIMEOUT
	if (MONGO_SETUP_CODES.has(code)) return DATABASE_SETUP
	if (MONGO_INPUT_CODES.has(code)) return mentionsPattern(message) ? PATTERN_REFUSED : QUERY_REFUSED
	return { kind: 'unavailable' }
}

/** Postgres SQLSTATEs a missing table, column, schema or grant raises: the install's to fix. */
const POSTGRES_SETUP: ReadonlySet<string> = new Set(['42501', '42P01', '42703', '3F000'])

/**
 * Class 22 (data exception) and 42 (syntax or rule) refuse the statement as written, 54 says it is
 * too complex; 57014 is the statement timeout. Any other class (connections, locks) is transient.
 */
const postgresFailure = (sqlState: string): ReadFailure | null => {
	if (sqlState === '2201B') return PATTERN_REFUSED
	if (sqlState === '57014') return DATABASE_TIMEOUT
	if (POSTGRES_SETUP.has(sqlState)) return DATABASE_SETUP
	const sqlClass = sqlState.slice(0, 2)
	if (sqlClass === '22' || sqlClass === '42' || sqlClass === '54') return QUERY_REFUSED
	return null
}

const SQLITE_TRANSIENT: ReadonlySet<string> = new Set([
	'SQLITE_BUSY',
	'SQLITE_LOCKED',
	'SQLITE_IOERR',
	'SQLITE_FULL',
	'SQLITE_CANTOPEN',
	'SQLITE_NOMEM',
	'SQLITE_PROTOCOL',
	'SQLITE_CORRUPT',
	'SQLITE_NOTADB',
])

const sqliteFailure = (code: string, message: string | undefined): ReadFailure => {
	const primary = code.match(/^SQLITE_[A-Z]+/)?.[0] ?? code
	if (primary === 'SQLITE_INTERRUPT') return DATABASE_TIMEOUT
	if (SQLITE_TRANSIENT.has(primary)) return { kind: 'unavailable' }
	if (primary === 'SQLITE_AUTH' || primary === 'SQLITE_PERM') return DATABASE_SETUP
	if (
		primary === 'SQLITE_ERROR' &&
		message !== undefined &&
		/no such (table|column)/i.test(message)
	) {
		return DATABASE_SETUP
	}
	if (mentionsPattern(message)) return PATTERN_REFUSED
	if (
		primary === 'SQLITE_ERROR' ||
		primary === 'SQLITE_TOOBIG' ||
		primary === 'SQLITE_RANGE' ||
		primary === 'SQLITE_MISMATCH'
	) {
		return QUERY_REFUSED
	}
	return { kind: 'unavailable' }
}

/**
 * A database driver's error (Mongo, node-postgres, libsql), read by its own code so a query the
 * database refuses is never taken for an outage, and Mongo's small numeric codes never for gRPC's.
 */
const databaseFailure = (link: object): ReadFailure | null => {
	const message = textAt(link, 'message')
	const code: unknown = Reflect.get(link, 'code')
	const name = textAt(link, 'name')
	if (
		typeof code === 'number' &&
		(textAt(link, 'codeName') !== undefined || name?.startsWith('Mongo') === true)
	) {
		return mongoFailure(code, message)
	}
	if (typeof code !== 'string') {
		return null
	}
	if (/^[0-9A-Z]{5}$/.test(code) && textAt(link, 'severity') !== undefined) {
		return postgresFailure(code)
	}
	if (code.startsWith('SQLITE_')) {
		return sqliteFailure(code, message)
	}
	return null
}

const retryAfterOf = (value: object): { retryAfterMs: number } | Record<string, never> => {
	const retryAfterMs = numberAt(value, 'retryAfterMs')
	return retryAfterMs !== undefined && retryAfterMs >= 0
		? { retryAfterMs: Math.min(retryAfterMs, BREAKER_MAX_MS) }
		: {}
}

/** Links of an error's cause chain {@link classifyError} reads at most. */
const MAX_CAUSE_DEPTH = 5

/** The signal one link of an error's cause chain carries, or null when it carries none. */
const classifyLink = (link: object): ReadFailure | null => {
	if (isReadFailed(link)) {
		return link.failure
	}
	if (isLaneRefused(link)) {
		// A breaker opened by a refused key or host answers as that refusal, not as an outage: the
		// settings still need changing, and waiting out the rest will not do it.
		return link.opened?.kind === 'source_misconfigured'
			? {
					kind: 'source_misconfigured',
					...(link.opened.hostRefused ? { hostRefused: true } : {}),
					retryAfterMs: link.retryAfterMs,
				}
			: { kind: 'unavailable', retryAfterMs: link.retryAfterMs }
	}
	if (link instanceof ScopeBusyError) {
		return { kind: 'rate_limited', retryAfterMs: link.retryAfterMs }
	}
	const name: unknown = Reflect.get(link, 'name')
	const message: unknown = Reflect.get(link, 'message')
	if (name === 'DecryptFailedError') {
		return { kind: 'source_misconfigured' }
	}
	if (
		(typeof name === 'string' && TIMEOUT_NAMES.has(name)) ||
		message === PROVIDER_READ_TIMEOUT_MESSAGE
	) {
		return {
			kind: 'unavailable',
			timeout: true,
			...(Reflect.get(link, 'refused') === true ? { refused: true as const } : {}),
		}
	}
	const status = numberAt(link, 'status')
	if (status !== undefined && status >= 100 && status < 600) {
		return { kind: httpStatusKind(status), ...retryAfterOf(link) }
	}
	const database = databaseFailure(link)
	if (database) {
		return database
	}
	// GA4's client rejects with a GoogleError whose numeric `code` is the gRPC status; Node's own
	// network errors carry string codes, and a DOMException's legacy numeric code means nothing here.
	const code = link instanceof DOMException ? undefined : numberAt(link, 'code')
	if (code !== undefined && Number.isInteger(code) && code >= 1 && code <= 16) {
		return {
			kind: grpcCodeKind(code),
			...(GRPC_TIMEOUT.has(code) ? { timeout: true as const } : {}),
			...(code === GRPC_QUOTA ? { quota: true as const } : {}),
			...retryAfterOf(link),
		}
	}
	return null
}

/**
 * Classifies anything a read can throw: the plugin's own refusals first, anywhere in the cause
 * chain, then the first HTTP status or gRPC code; anything else is presumed `unavailable`.
 */
export const classifyError = (err: unknown): ReadFailure => {
	if (isReadFailed(err)) {
		return err.failure
	}
	const filter = refusedFilter(err)
	if (filter) {
		return {
			kind: 'invalid_param',
			param: 'filters',
			message: `analytics: this source cannot filter ${filter.dimension} with ${filter.operator}`,
		}
	}
	const invalid = invalidQuery(err)
	if (invalid) {
		return { kind: 'invalid_param', param: invalid.param, message: invalid.message }
	}
	if (isSourceMisconfigured(err)) {
		return { kind: 'source_misconfigured', ...(isHostRefused(err) ? { hostRefused: true } : {}) }
	}
	let current: unknown = err
	for (let depth = 0; depth < MAX_CAUSE_DEPTH && isRecord(current); depth++) {
		const found = classifyLink(current)
		if (found) {
			return found
		}
		current = Reflect.get(current, 'cause')
	}
	return { kind: 'unavailable' }
}

/**
 * What a surface shows for a failed read; only `busy` (an outage, a timeout or a full queue) is
 * one a retry can fix.
 */
export type ReadFailureStatus = 'misconfigured' | 'host-refused' | 'invalid' | 'busy'

export interface ReadFailureState {
	status: ReadFailureStatus
	/** How long until a retry can succeed, when the source or the plugin knows. */
	retryAfterMs?: number
}

/** A failed read as a surface shows it. */
export const readFailureOf = (err: unknown): ReadFailureState => {
	const failure = classifyError(err)
	switch (failure.kind) {
		case 'source_misconfigured':
			return { status: failure.hostRefused ? 'host-refused' : 'misconfigured' }
		case 'invalid_param':
			return { status: 'invalid' }
		case 'unavailable':
		case 'rate_limited':
			return {
				status: 'busy',
				...(failure.retryAfterMs === undefined ? {} : { retryAfterMs: failure.retryAfterMs }),
			}
	}
}
