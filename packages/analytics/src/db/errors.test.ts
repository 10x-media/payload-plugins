import { ValidationError } from 'payload'
import { describe, expect, it } from 'vitest'
import {
	isInvalidPattern,
	isMongoOverLimit,
	isRowError,
	isSqliteLockFailure,
	isStatementTimeout,
	isUniqueViolation,
	type UniqueMessageSource,
} from './errors'

const driverError = (message: string, fields: Record<string, unknown>): Error =>
	Object.assign(new Error(message), fields)

/** Drizzle's DrizzleQueryError: the statement as its message, the driver error as its cause. */
const drizzleWrapped = (cause: unknown): Error =>
	Object.assign(new Error('Failed query: insert into "probe" ("key") values ($1)'), { cause })

const mongoDuplicate = driverError(
	'E11000 duplicate key error collection: test.probe index: key_1 dup key: { key: "a" }',
	{ name: 'MongoServerError', code: 11000, keyValue: { key: 'a' } }
)
const postgresDuplicate = driverError(
	'duplicate key value violates unique constraint "probe_key_idx"',
	{ code: '23505', constraint: 'probe_key_idx', detail: 'Key (key)=(a) already exists.' }
)
const sqliteDuplicate = driverError(
	'SQLITE_CONSTRAINT_UNIQUE: UNIQUE constraint failed: probe.key',
	{ name: 'LibsqlError', code: 'SQLITE_CONSTRAINT_UNIQUE', rawCode: 2067 }
)
const sqlitePrimaryKey = driverError(
	'SQLITE_CONSTRAINT_PRIMARYKEY: UNIQUE constraint failed: probe.id',
	{ name: 'LibsqlError', code: 'SQLITE_CONSTRAINT_PRIMARYKEY', rawCode: 1555 }
)

const uniqueFailure = (message: string): ValidationError =>
	new ValidationError({ collection: 'probe', errors: [{ message, path: 'key' }] })

const withTranslation = (language: string, text: string): UniqueMessageSource =>
	({
		config: {
			i18n: {
				supportedLanguages: {
					[language]: {
						dateFNSKey: language,
						translations: { error: { valueMustBeUnique: text } },
					},
				},
				translations: {},
			},
		},
	}) as unknown as UniqueMessageSource

describe('isUniqueViolation per driver', () => {
	it('recognizes Mongo, Postgres and SQLite refusals as thrown', () => {
		expect(isUniqueViolation(mongoDuplicate)).toBe(true)
		expect(isUniqueViolation(postgresDuplicate)).toBe(true)
		expect(isUniqueViolation(sqliteDuplicate)).toBe(true)
		expect(isUniqueViolation(sqlitePrimaryKey)).toBe(true)
	})

	it('recognizes them wrapped the way drizzle wraps a driver error', () => {
		expect(isUniqueViolation(drizzleWrapped(postgresDuplicate))).toBe(true)
		expect(isUniqueViolation(drizzleWrapped(sqliteDuplicate))).toBe(true)
		expect(isUniqueViolation(drizzleWrapped(drizzleWrapped(sqlitePrimaryKey)))).toBe(true)
	})

	it('reads a SQLite code from extendedCode or the raw number when that is all it has', () => {
		expect(
			isUniqueViolation({ code: 'SQLITE_CONSTRAINT', extendedCode: 'SQLITE_CONSTRAINT_UNIQUE' })
		).toBe(true)
		expect(isUniqueViolation({ rawCode: 1555 })).toBe(true)
	})

	it('counts a Mongo bulk write only when every row it lost was lost to the index', () => {
		const bulk = (codes: number[]) =>
			driverError('E11000 duplicate key error', {
				code: 11000,
				writeErrors: codes.map((code, index) => ({ code, index })),
			})
		expect(isUniqueViolation(bulk([11000, 11000]))).toBe(true)
		expect(isUniqueViolation(bulk([11000, 121]))).toBe(false)
	})

	it('falls back to the driver wording only when an error carries no code', () => {
		// D1 reports a constraint by message alone.
		expect(
			isUniqueViolation(
				new Error('D1_ERROR: UNIQUE constraint failed: probe.key: SQLITE_CONSTRAINT')
			)
		).toBe(true)
		expect(isUniqueViolation(new Error('duplicate key value violates unique constraint "k"'))).toBe(
			true
		)
		// A remote libsql sends the bare primary code, so the wording decides which constraint.
		expect(
			isUniqueViolation(
				driverError('SQLITE_CONSTRAINT: UNIQUE constraint failed: probe.key', {
					code: 'SQLITE_CONSTRAINT',
				})
			)
		).toBe(true)
		expect(
			isUniqueViolation(
				driverError('SQLITE_CONSTRAINT: NOT NULL constraint failed: probe.key', {
					code: 'SQLITE_CONSTRAINT',
				})
			)
		).toBe(false)
		// A definite code wins over a message that happens to read like a duplicate.
		expect(
			isUniqueViolation(
				driverError('duplicate key value violates unique constraint', { code: '23502' })
			)
		).toBe(false)
	})

	it('answers false for every other failure', () => {
		expect(isUniqueViolation(driverError('null value in column "key"', { code: '23502' }))).toBe(
			false
		)
		expect(isUniqueViolation(driverError('Document failed validation', { code: 121 }))).toBe(false)
		expect(
			isUniqueViolation(
				driverError('SQLITE_CONSTRAINT_NOTNULL: NOT NULL constraint failed: probe.key', {
					code: 'SQLITE_CONSTRAINT_NOTNULL',
					rawCode: 1299,
				})
			)
		).toBe(false)
		expect(isUniqueViolation(drizzleWrapped(new Error('connection refused')))).toBe(false)
		expect(isUniqueViolation(new Error('duplicate key'))).toBe(false)
		expect(isUniqueViolation('E11000 duplicate key error')).toBe(false)
		expect(isUniqueViolation(undefined)).toBe(false)
		expect(isUniqueViolation(null)).toBe(false)
	})
})

describe('isUniqueViolation on Payload ValidationErrors', () => {
	it('recognizes the error Payload adapters raise in place of the driver one', () => {
		expect(isUniqueViolation(uniqueFailure('Value must be unique'))).toBe(true)
	})

	it('refuses a ValidationError about anything other than uniqueness', () => {
		expect(isUniqueViolation(uniqueFailure('This field is required.'))).toBe(false)
		expect(
			isUniqueViolation(
				new ValidationError({
					collection: 'probe',
					errors: [
						{ message: 'Value must be unique', path: 'key' },
						{ message: 'This field is required.', path: 'title' },
					],
				})
			)
		).toBe(false)
		expect(isUniqueViolation(new ValidationError({ collection: 'probe', errors: [] }))).toBe(false)
	})

	it('recognizes one raised by another copy of payload, by its name', () => {
		const foreign = driverError('The following field is invalid: key', {
			name: 'ValidationError',
			data: { errors: [{ message: 'Value must be unique', path: 'key' }] },
		})
		expect(isUniqueViolation(foreign)).toBe(true)
	})

	it('reads the wording in any language the install configures, given the payload', () => {
		const german = uniqueFailure('Wert muss eindeutig sein')
		expect(isUniqueViolation(german)).toBe(false)
		expect(isUniqueViolation(german, withTranslation('de', 'Wert muss eindeutig sein'))).toBe(true)
	})

	it('reads a host override of the wording too', () => {
		const source = {
			config: {
				i18n: {
					supportedLanguages: {},
					translations: { en: { error: { valueMustBeUnique: 'Already taken' } } },
				},
			},
		} as unknown as UniqueMessageSource
		expect(isUniqueViolation(uniqueFailure('Already taken'), source)).toBe(true)
		expect(isUniqueViolation(uniqueFailure('Value must be unique'), source)).toBe(true)
	})

	it('never reads the configured languages for a driver error', () => {
		const unreadable = {
			get config(): never {
				throw new Error('read the config')
			},
		}
		expect(isUniqueViolation(postgresDuplicate, unreadable)).toBe(true)
		expect(isUniqueViolation(new Error('connection refused'), unreadable)).toBe(false)
	})
})

describe('isUniqueViolation cause chains', () => {
	it('stops on a cyclic chain', () => {
		const loop: { message: string; cause?: unknown } = { message: 'loop' }
		loop.cause = loop
		expect(isUniqueViolation(loop)).toBe(false)
	})

	it('stops past the depth any real wrapper reaches', () => {
		let error: unknown = postgresDuplicate
		for (let depth = 0; depth < 12; depth++) {
			error = drizzleWrapped(error)
		}
		expect(isUniqueViolation(error)).toBe(false)
	})
})

describe('isSqliteLockFailure', () => {
	it('knows a lock another connection holds, by code, extended code or libsql wording', () => {
		expect(isSqliteLockFailure(driverError('database is locked', { code: 'SQLITE_BUSY' }))).toBe(
			true
		)
		expect(
			isSqliteLockFailure(
				driverError('x', { code: 'SQLITE_ERROR', extendedCode: 'SQLITE_BUSY_SNAPSHOT' })
			)
		).toBe(true)
		expect(isSqliteLockFailure(new Error('SQLITE_LOCKED: database table is locked'))).toBe(true)
		expect(
			isSqliteLockFailure(
				new Error('read failed', { cause: { code: 'SQLITE_BUSY', message: 'y' } })
			)
		).toBe(true)
	})

	it('is false for every failure that leaves the connection usable, and for a cyclic chain', () => {
		expect(
			isSqliteLockFailure(
				driverError('UNIQUE constraint failed', { code: 'SQLITE_CONSTRAINT_UNIQUE' })
			)
		).toBe(false)
		expect(isSqliteLockFailure(driverError('no such table: x', { code: 'SQLITE_ERROR' }))).toBe(
			false
		)
		expect(isSqliteLockFailure(undefined)).toBe(false)
		const loop: { message: string; cause?: unknown } = { message: 'loop' }
		loop.cause = loop
		expect(isSqliteLockFailure(loop)).toBe(false)
	})
})

describe('isStatementTimeout', () => {
	it("knows Postgres' statement timeout and Mongo's maxTimeMS, wrapped or not", () => {
		const postgres = Object.assign(new Error('canceling statement due to statement timeout'), {
			code: '57014',
		})
		const mongo = Object.assign(new Error('operation exceeded time limit'), {
			code: 50,
			codeName: 'MaxTimeMSExpired',
		})
		expect(isStatementTimeout(postgres)).toBe(true)
		expect(isStatementTimeout(mongo)).toBe(true)
		expect(isStatementTimeout({ codeName: 'MaxTimeMSExpired' })).toBe(true)
		expect(isStatementTimeout(new Error('wrapped', { cause: postgres }))).toBe(true)
	})

	it('is false for any other failure, and for a cyclic chain', () => {
		expect(isStatementTimeout(Object.assign(new Error('dup'), { code: '23505' }))).toBe(false)
		expect(isStatementTimeout(new Error('connection refused'))).toBe(false)
		expect(isStatementTimeout(undefined)).toBe(false)
		const loop: { message: string; cause?: unknown } = { message: 'loop' }
		loop.cause = loop
		expect(isStatementTimeout(loop)).toBe(false)
	})
})

describe('isMongoOverLimit', () => {
	it('knows a set that outgrew its memory and a document past 16 MB, by code or name, wrapped', () => {
		const set = Object.assign(
			new Error('$addToSet used too much memory and cannot spill to disk'),
			{
				code: 146,
				codeName: 'ExceededMemoryLimit',
			}
		)
		expect(isMongoOverLimit(set)).toBe(true)
		expect(isMongoOverLimit({ code: 10334 })).toBe(true)
		expect(isMongoOverLimit({ codeName: 'QueryExceededMemoryLimitNoDiskUseAllowed' })).toBe(true)
		expect(isMongoOverLimit(new Error('aggregation failed', { cause: set }))).toBe(true)
	})

	it('is false for a timeout, any other failure, and a cyclic chain', () => {
		expect(isMongoOverLimit({ code: 50, codeName: 'MaxTimeMSExpired' })).toBe(false)
		expect(isMongoOverLimit(new Error('connection refused'))).toBe(false)
		const loop: { message: string; cause?: unknown } = { message: 'loop' }
		loop.cause = loop
		expect(isMongoOverLimit(loop)).toBe(false)
	})
})

describe('isRowError', () => {
	it("reads each driver's refusal of a row's values, wrapped or not", () => {
		const tooLong = driverError('value too long for type character varying(16)', {
			code: '22001',
		})
		const notNull = driverError('null value in column "scope" violates not-null constraint', {
			code: '23502',
		})
		const mismatch = driverError('SQLITE_MISMATCH: datatype mismatch', {
			code: 'SQLITE_MISMATCH',
		})
		const constraint = driverError('SQLITE_CONSTRAINT: NOT NULL constraint failed', {
			code: 'SQLITE_CONSTRAINT_NOTNULL',
		})
		const bulk = driverError('E121 Document failed validation', {
			writeErrors: [{ code: 121 }],
		})
		for (const error of [tooLong, notNull, mismatch, constraint, bulk]) {
			expect(isRowError(error)).toBe(true)
			expect(isRowError(drizzleWrapped(error))).toBe(true)
		}
	})

	it('leaves a lock, a timeout, a lost connection and an error with no code to the database', () => {
		for (const error of [
			driverError('SQLITE_BUSY: database is locked', { code: 'SQLITE_BUSY' }),
			driverError('canceling statement due to statement timeout', { code: '57014' }),
			driverError('terminating connection due to administrator command', { code: '57P01' }),
			driverError('connect ECONNREFUSED 127.0.0.1:5432', { code: 'ECONNREFUSED' }),
			driverError('write EPIPE', { code: 'EPIPE' }),
			driverError('connection pool closed', { name: 'MongoNotConnectedError' }),
			new Error('Connection terminated unexpectedly'),
		]) {
			expect(isRowError(error)).toBe(false)
		}
	})
})

describe('isInvalidPattern', () => {
	it("reads Postgres' and MongoDB's refusal of a regular expression, wrapped or not", () => {
		const postgres = driverError('invalid regular expression: brackets [] not balanced', {
			code: '2201B',
		})
		const mongo = driverError('Regular expression is invalid: missing closing parenthesis', {
			code: 51091,
			codeName: 'Location51091',
		})
		expect(isInvalidPattern(postgres)).toBe(true)
		expect(isInvalidPattern(drizzleWrapped(postgres))).toBe(true)
		expect(isInvalidPattern(mongo)).toBe(true)
		expect(isInvalidPattern(driverError('connection terminated', { code: '57P01' }))).toBe(false)
		expect(isInvalidPattern(undefined)).toBe(false)
	})
})
