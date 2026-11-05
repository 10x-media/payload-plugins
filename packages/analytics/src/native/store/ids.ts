import { createHash, randomBytes } from 'node:crypto'
import { DEDUPE_KEY_PREFIX } from '../ingest/revenue'

/** Crockford's base32, the ULID alphabet: no I, L, O or U, so an id reads back unambiguously. */
const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'
const TIME_CHARS = 10
const RANDOM_CHARS = 16
/** 80 bits of randomness, 16 characters of 5 bits each. */
const RANDOM_BYTES = 10
const MAX_TIME = 2 ** 48 - 1

export const ULID_LENGTH = TIME_CHARS + RANDOM_CHARS

const encodeTime = (ms: number): string => {
	let out = ''
	let rest = ms
	for (let i = 0; i < TIME_CHARS; i++) {
		out = ALPHABET.charAt(rest % 32) + out
		rest = Math.floor(rest / 32)
	}
	return out
}

/** Ten random bytes as sixteen 5-bit digits, most significant first. */
const digitsOf = (bytes: Uint8Array): number[] => {
	let value = 0n
	for (const byte of bytes) {
		value = (value << 8n) | BigInt(byte)
	}
	const digits: number[] = []
	for (let i = RANDOM_CHARS - 1; i >= 0; i--) {
		digits.push(Number((value >> BigInt(i * 5)) & 31n))
	}
	return digits
}

/** The next value of the random part, so a second id in one millisecond sorts after the first. */
const increment = (digits: readonly number[]): number[] => {
	const next = [...digits]
	for (let i = next.length - 1; i >= 0; i--) {
		const digit = next[i] ?? 0
		if (digit < 31) {
			next[i] = digit + 1
			return next
		}
		next[i] = 0
	}
	throw new RangeError('analytics: ran out of ids for one millisecond')
}

export type UlidFactory = (at: number | Date) => string

/**
 * ULIDs from a given time, so primary key inserts stay at the index's right edge. Ids in a row for
 * one millisecond increment the random part, so they sort in the order they were made.
 */
export const createUlidFactory = (
	random: (size: number) => Uint8Array = randomBytes
): UlidFactory => {
	let lastTime = -1
	let lastDigits: number[] = []
	return (at) => {
		const time = typeof at === 'number' ? at : at.getTime()
		if (!Number.isInteger(time) || time < 0 || time > MAX_TIME) {
			throw new RangeError(`analytics: a ULID needs a time between 0 and 2^48, got ${time}`)
		}
		if (time === lastTime) {
			lastDigits = increment(lastDigits)
		} else {
			lastTime = time
			lastDigits = digitsOf(random(RANDOM_BYTES))
		}
		return encodeTime(time) + lastDigits.map((digit) => ALPHABET.charAt(digit)).join('')
	}
}

/** The process's own factory, so every id one process makes in a millisecond is in order. */
export const ulid: UlidFactory = createUlidFactory()

/** The millisecond a ULID was made for, or null for anything that is not one. */
export const ulidTime = (id: string): number | null => {
	if (id.length !== ULID_LENGTH) {
		return null
	}
	let time = 0
	for (const char of id.slice(0, TIME_CHARS)) {
		const digit = ALPHABET.indexOf(char)
		if (digit === -1) {
			return null
		}
		time = time * 32 + digit
	}
	for (const char of id.slice(TIME_CHARS)) {
		if (!ALPHABET.includes(char)) {
			return null
		}
	}
	return time <= MAX_TIME ? time : null
}

/**
 * The id of an order's hit: its dedupe key (`s.<sha256>` or `w.<sha256>`) behind an `o`, so a
 * retried webhook writes the same primary key and the database refuses the second row.
 */
export const orderHitId = (dedupeKey: string): string => `o${dedupeKey}`

/** What every order's hit id starts with, which no ULID does: a ULID is upper case throughout. */
export const ORDER_PREFIX = orderHitId('')

export const isOrderHitId = (id: string): boolean => id.startsWith(ORDER_PREFIX)

/** How the browser's record of an order starts (`ow.`), and the server's (`os.`). */
export const WIRE_ORDER_PREFIX = orderHitId(DEDUPE_KEY_PREFIX.wire)
export const SERVER_ORDER_PREFIX = orderHitId(DEDUPE_KEY_PREFIX.server)

/**
 * The id the server's record of the same order has, for the browser's record of one; undefined for
 * any other id. While that id is stored, a read credits the server's sale to the browser's record.
 */
export const serverTwinOf = (id: string): string | undefined =>
	id.startsWith(WIRE_ORDER_PREFIX)
		? `${SERVER_ORDER_PREFIX}${id.slice(WIRE_ORDER_PREFIX.length)}`
		: undefined

/**
 * The id the browser's record of the same order has, for the server's record of one. While that id
 * is stored, a read counts the server's record not at all.
 */
export const wireTwinOf = (id: string): string | undefined =>
	id.startsWith(SERVER_ORDER_PREFIX)
		? `${WIRE_ORDER_PREFIX}${id.slice(SERVER_ORDER_PREFIX.length)}`
		: undefined

/** The id of an order's other record, for either record of one; undefined for any other id. */
export const orderTwinOf = (id: string): string | undefined => serverTwinOf(id) ?? wireTwinOf(id)

/** What one aggregate row counts: a scope's local day on one host, by one or two dimensions. */
interface AggregateIdParts {
	scope: string
	/** `yyyymmdd` in the scope's reporting zone. */
	day: number
	hostname: string
	dim: string
	value: string
	dim2: string
	value2: string
}

/**
 * An aggregate row's id from its own key, the same for every generation of the day. JSON keeps the
 * parts apart: no separator can be smuggled into a value to make two keys read alike.
 */
export const aggregateId = (parts: AggregateIdParts): string =>
	createHash('sha256')
		.update(
			JSON.stringify([
				parts.scope,
				parts.day,
				parts.hostname,
				parts.dim,
				parts.value,
				parts.dim2,
				parts.value2,
			])
		)
		.digest('base64url')
		.slice(0, 22)

/**
 * A SQL aggregate row's primary key: its key's id and its generation hashed into the same 22
 * characters, so generations sit side by side without a longer key in the table and its index.
 */
export const generationRowId = (record: { id: string; gen: string }): string =>
	createHash('sha256').update(`${record.id}:${record.gen}`).digest('base64url').slice(0, 22)
