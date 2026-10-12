import { type Payload, ValidationError } from 'payload'
import { isRecord } from '../core/values'

const MONGO_DUPLICATE_KEY = 11000
const POSTGRES_UNIQUE_VIOLATION = '23505'
/** SQLite's extended codes for a unique index and a primary key, by name and by number. */
const SQLITE_UNIQUE_NAMES: ReadonlySet<string> = new Set([
	'SQLITE_CONSTRAINT_UNIQUE',
	'SQLITE_CONSTRAINT_PRIMARYKEY',
])
const SQLITE_UNIQUE_NUMBERS: ReadonlySet<number> = new Set([2067, 1555])
/** SQLite's primary code, which a remote driver can send for every kind of constraint alike. */
const SQLITE_CONSTRAINT = 'SQLITE_CONSTRAINT'

/**
 * Each driver's own wording, for an error that carries no code to read (D1 reports only the
 * message). A code, when present, always wins over the text beside it.
 */
const UNIQUE_TEXT: readonly RegExp[] = [
	/E11000 duplicate key/,
	/duplicate key value violates unique constraint/,
	/UNIQUE constraint failed/,
]

/** What Payload's adapters write in place of the driver error when no translator was at hand. */
const PAYLOAD_UNIQUE_MESSAGE = 'Value must be unique'
const DEFAULT_MESSAGES: ReadonlySet<string> = new Set([PAYLOAD_UNIQUE_MESSAGE])

/** Deeper than any wrapper nests a driver error; also the guard against a cyclic chain. */
const MAX_DEPTH = 8

/** The parts of a config that decide which languages Payload's error text can come in. */
export interface UniqueMessageSource {
	config: { i18n: Pick<Payload['config']['i18n'], 'supportedLanguages' | 'translations'> }
}

const read = (value: object, key: string): unknown =>
	key in value ? Reflect.get(value, key) : undefined

const objectOrUndefined = (value: unknown): object | undefined =>
	isRecord(value) ? value : undefined

/** Whether `test` holds for `error` or for any error along its `cause` chain. */
const alongCauses = (error: unknown, test: (level: object) => boolean): boolean => {
	const seen = new Set<object>()
	let level = objectOrUndefined(error)
	while (level && !seen.has(level) && seen.size < MAX_DEPTH) {
		seen.add(level)
		if (test(level)) {
			return true
		}
		level = objectOrUndefined(read(level, 'cause'))
	}
	return false
}

const driverReportsUnique = (level: object): boolean => {
	const writeErrors = read(level, 'writeErrors')
	if (Array.isArray(writeErrors) && writeErrors.length > 0) {
		// A bulk write counts only when every row it lost was lost to the index.
		return writeErrors.every((entry: unknown) => {
			const row = objectOrUndefined(entry)
			return row !== undefined && read(row, 'code') === MONGO_DUPLICATE_KEY
		})
	}
	const code = read(level, 'code')
	if (code === MONGO_DUPLICATE_KEY || code === POSTGRES_UNIQUE_VIOLATION) {
		return true
	}
	const extendedCode = read(level, 'extendedCode')
	const rawCode = read(level, 'rawCode')
	if (
		(typeof code === 'string' && SQLITE_UNIQUE_NAMES.has(code)) ||
		(typeof extendedCode === 'string' && SQLITE_UNIQUE_NAMES.has(extendedCode)) ||
		(typeof rawCode === 'number' && SQLITE_UNIQUE_NUMBERS.has(rawCode))
	) {
		return true
	}
	if (code !== undefined && code !== null && code !== SQLITE_CONSTRAINT) {
		return false
	}
	const message = read(level, 'message')
	return typeof message === 'string' && UNIQUE_TEXT.some((pattern) => pattern.test(message))
}

/**
 * Payload's adapters replace a driver's unique refusal with a ValidationError whose every entry
 * says the value must be unique, keeping no trace of the driver error.
 */
const payloadReportsUnique = (
	level: object,
	uniqueMessages: () => ReadonlySet<string>
): boolean => {
	if (!(level instanceof ValidationError) && read(level, 'name') !== 'ValidationError') {
		return false
	}
	const data = objectOrUndefined(read(level, 'data'))
	const errors = data ? read(data, 'errors') : undefined
	if (!Array.isArray(errors) || errors.length === 0) {
		return false
	}
	const messages = uniqueMessages()
	return errors.every((entry: unknown) => {
		const row = objectOrUndefined(entry)
		const message = row ? read(row, 'message') : undefined
		return typeof message === 'string' && messages.has(message)
	})
}

const translatedUniqueMessage = (translations: unknown): string | undefined => {
	const all = objectOrUndefined(translations)
	const errors = all ? objectOrUndefined(read(all, 'error')) : undefined
	const text = errors ? read(errors, 'valueMustBeUnique') : undefined
	return typeof text === 'string' && text !== '' ? text : undefined
}

const messagesByI18n = new WeakMap<object, ReadonlySet<string>>()

/**
 * Every wording `error:valueMustBeUnique` can take in one install: the English default, each
 * configured language's own and any override the host supplied.
 */
const uniqueMessagesOf = (source: UniqueMessageSource): ReadonlySet<string> => {
	const { i18n } = source.config
	const cached = messagesByI18n.get(i18n)
	if (cached) {
		return cached
	}
	const messages = new Set(DEFAULT_MESSAGES)
	const candidates = [
		...Object.values(i18n.supportedLanguages ?? {}).map((language) => language?.translations),
		...Object.values(i18n.translations ?? {}),
	]
	for (const candidate of candidates) {
		const text = translatedUniqueMessage(candidate)
		if (text) {
			messages.add(text)
		}
	}
	messagesByI18n.set(i18n, messages)
	return messages
}

/** Postgres' query_canceled, which `statement_timeout` raises. */
const POSTGRES_QUERY_CANCELED = '57014'
const MONGO_MAX_TIME_EXPIRED = 50

const driverReportsTimeout = (level: object): boolean => {
	const code = read(level, 'code')
	return (
		code === POSTGRES_QUERY_CANCELED ||
		code === MONGO_MAX_TIME_EXPIRED ||
		read(level, 'codeName') === 'MaxTimeMSExpired'
	)
}

/** Mongo's refusals of a stage that outgrew its memory, or of a document past 16 MB. */
const MONGO_OVER_LIMIT_CODES: ReadonlySet<number> = new Set([146, 292, 10334])
const MONGO_OVER_LIMIT_NAMES: ReadonlySet<string> = new Set([
	'ExceededMemoryLimit',
	'QueryExceededMemoryLimitNoDiskUseAllowed',
	'BSONObjectTooLarge',
])

const driverReportsOverLimit = (level: object): boolean => {
	const code = read(level, 'code')
	const name = read(level, 'codeName')
	return (
		(typeof code === 'number' && MONGO_OVER_LIMIT_CODES.has(code)) ||
		(typeof name === 'string' && MONGO_OVER_LIMIT_NAMES.has(name))
	)
}

/**
 * True when MongoDB refused an aggregation for outgrowing a stage's memory (`$addToSet` cannot
 * spill to disk) or a document's 16 MB, anywhere along the `cause` chain.
 */
export const isMongoOverLimit = (error: unknown): boolean =>
	alongCauses(error, driverReportsOverLimit)

/** SQLite's codes for a lock another connection holds, which libsql opens its messages with. */
const SQLITE_LOCK_CODE = /^SQLITE_(BUSY|LOCKED)/

const driverReportsLock = (level: object): boolean =>
	['code', 'extendedCode', 'message'].some((key) => {
		const value = read(level, key)
		return typeof value === 'string' && SQLITE_LOCK_CODE.test(value)
	})

/**
 * True when SQLite refused a statement for another connection's lock, anywhere along the `cause`
 * chain. libsql then commits nothing on that connection until it is replaced.
 */
export const isSqliteLockFailure = (error: unknown): boolean =>
	alongCauses(error, driverReportsLock)

/** True when the database hit a statement's time limit, anywhere along the `cause` chain. */
export const isStatementTimeout = (error: unknown): boolean =>
	alongCauses(error, driverReportsTimeout)

/** Postgres' data exception and integrity constraint classes: the row's values are refused. */
const POSTGRES_ROW_CLASSES: readonly string[] = ['22', '23']
/** SQLite's primary codes for a row's values refused, which the extended codes start with. */
const SQLITE_ROW_CODES = /^SQLITE_(CONSTRAINT|MISMATCH|TOOBIG|RANGE)/
/** MongoDB's codes for a document refused: bad value, failed validation, past 16 MB. */
const MONGO_ROW_CODES: ReadonlySet<number> = new Set([2, 121, 10334])

const driverReportsRowError = (level: object): boolean => {
	const writeErrors = read(level, 'writeErrors')
	if (Array.isArray(writeErrors) && writeErrors.length > 0) {
		return true
	}
	const code = read(level, 'code')
	if (typeof code === 'number') {
		return MONGO_ROW_CODES.has(code)
	}
	if (typeof code === 'string' && /^[0-9A-Z]{5}$/.test(code)) {
		return POSTGRES_ROW_CLASSES.includes(code.slice(0, 2))
	}
	return ['code', 'extendedCode'].some((key) => {
		const value = read(level, key)
		return typeof value === 'string' && SQLITE_ROW_CODES.test(value)
	})
}

/**
 * True when the database refused a write for its rows' values, anywhere along the `cause` chain;
 * anything else (a lock, a timeout, a lost connection, no code) is a state every row would meet.
 */
export const isRowError = (error: unknown): boolean => alongCauses(error, driverReportsRowError)

const POSTGRES_INVALID_REGEX = '2201B'
const MONGO_INVALID_REGEX = 51091

const driverReportsInvalidPattern = (level: object): boolean => {
	const code = read(level, 'code')
	const message = read(level, 'message')
	return (
		code === POSTGRES_INVALID_REGEX ||
		code === MONGO_INVALID_REGEX ||
		(typeof message === 'string' && message.startsWith('Regular expression is invalid'))
	)
}

/** True when the database refused a read's regular expression, anywhere along the `cause` chain. */
export const isInvalidPattern = (error: unknown): boolean =>
	alongCauses(error, driverReportsInvalidPattern)

/**
 * True when a write's key already exists, anywhere along the `cause` chain. Pass `payload` for a
 * Local API write: Payload words that error in the request's language, else only English matches.
 */
export const isUniqueViolation = (error: unknown, payload?: UniqueMessageSource): boolean => {
	const uniqueMessages = (): ReadonlySet<string> =>
		payload ? uniqueMessagesOf(payload) : DEFAULT_MESSAGES
	return alongCauses(
		error,
		(level) => driverReportsUnique(level) || payloadReportsUnique(level, uniqueMessages)
	)
}
