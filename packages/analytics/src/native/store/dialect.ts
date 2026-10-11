import { ident, join, raw, type SqlArgument, type SqlFragment, sql } from './sql/fragment'

/** The scalar types the engine casts to. */
type SqlScalar = 'integer' | 'real' | 'text'

/**
 * What differs between Postgres and SQLite in the engine's SQL. Helpers build fragments, so a
 * compared value is bound like any other parameter and placeholders are numbered once.
 */
export interface SqlDialect {
	readonly name: 'postgres' | 'sqlite'
	/** The placeholder of the n-th parameter, counted from 1: `$n` or `?`. */
	placeholder(index: number): string
	/** A quoted identifier. */
	identifier(name: string): string
	/** A table, schema-qualified where the database has schemas and the adapter names one. */
	table(name: string, schema?: string): string
	/**
	 * How an instant is bound: ISO text on both. SQLite stores dates as that text and compares
	 * it as text, which orders like time only for one fixed format.
	 */
	timestamp(value: Date): string
	/** How a boolean is bound: a boolean on Postgres, 1 or 0 on SQLite. */
	boolean(value: boolean): boolean | number
	isTrue(expression: SqlFragment): SqlFragment
	cast(operand: SqlArgument, type: SqlScalar): SqlFragment
	/** Milliseconds since the epoch of a timestamp expression, as a number. */
	epochMs(expression: SqlFragment): SqlFragment
	/** Whether `later` is more than `minutes` after `earlier`, to the millisecond. */
	afterGap(later: SqlFragment, earlier: SqlFragment, minutes: number): SqlFragment
	/** Whether `a` lies no more than `seconds` before or after `b`, to the millisecond. */
	within(a: SqlFragment, b: SqlFragment, seconds: number): SqlFragment
	/** A case-insensitive substring match, the value bound with its wildcards escaped. */
	contains(expression: SqlFragment, value: string): SqlFragment
	/** A case-insensitive regular expression match; null where the database has none built in. */
	readonly matches: ((expression: SqlFragment, pattern: string) => SqlFragment) | null
	/** Text ordered by code point, as SQLite, MongoDB and JS compare it, whatever the collation. */
	byCodePoint(expression: SqlFragment): SqlFragment
	/**
	 * A join producing one row per element of a JSON array column, the element as `<alias>.value`:
	 * its text for `text`, the element itself for `json` (read with {@link jsonField}).
	 */
	crossJoinJsonArray(expression: SqlFragment, alias: string, elements: 'text' | 'json'): SqlFragment
	/** One key of a JSON object element. */
	jsonField(element: SqlFragment, key: string, type: 'text' | 'real'): SqlFragment
	/** How many elements a JSON array column holds; null for a null column. */
	jsonArrayLength(expression: SqlFragment): SqlFragment
	/**
	 * The sum over a JSON array column's object elements of the first of `keys` each one holds, as
	 * a number; null for a null or empty column.
	 */
	jsonArraySum(expression: SqlFragment, keys: readonly string[]): SqlFragment
	/** A JSON object column without one key; null stays null. */
	jsonWithout(expression: SqlFragment, key: string): SqlFragment
	/** Equality that holds for two NULLs. */
	nullSafeEquals(a: SqlFragment, b: SqlArgument): SqlFragment
	/** Bounds how long each following statement of a transaction may run; null where none can be. */
	statementTimeout(ms: number): string | null
	/** Bounds how long a statement waits for a lock another connection holds. */
	lockTimeout(ms: number): string
	/**
	 * Ends the session when the transaction idles this long between statements; null where no
	 * other session can be waiting on its locks (SQLite's one writer waits on its busy timeout).
	 */
	idleTimeout(ms: number): string | null
	/**
	 * What a long read (a day's count, a raw read) runs under in its transaction. Postgres: no JIT,
	 * whose compiling cost more than it saved, and sorts in 64 MB before they spill to disk.
	 */
	readonly analyticalSettings: readonly string[]
}

const quote = (name: string): string => `"${name.replaceAll('"', '""')}"`

const JSON_KEY = /^[A-Za-z_][A-Za-z0-9_]*$/

const jsonKey = (key: string): string => {
	if (!JSON_KEY.test(key)) {
		throw new Error(`analytics: "${key}" is not a JSON key the engine reads`)
	}
	return key
}

/** A whole number of milliseconds or minutes, which these helpers write into the SQL itself. */
const whole = (value: number, what: string): number => {
	if (!Number.isInteger(value) || value < 0) {
		throw new Error(`analytics: ${what} must be a whole number of at least 0, got ${value}`)
	}
	return value
}

/**
 * The bound side of a substring match: the value with `\`, `%` and `_` escaped, inside `%`, so
 * a visitor's `%` matches a percent sign rather than anything at all.
 */
export const containsPattern = (value: string): string =>
	`%${value.replace(/[\\%_]/g, (char) => `\\${char}`)}%`

const ESCAPE = raw("ESCAPE '\\'")

/**
 * The database's own collation for a case-insensitive match: a column compared by code point
 * (`COLLATE "C"`) would fold ASCII letters alone, where ILIKE folds every letter.
 */
const unicodeFolded = (expression: SqlFragment): SqlFragment =>
	sql`(${expression}) COLLATE "default"`

/** SQLite's `lower()` folds ASCII letters alone, so the needle is folded likewise, no further. */
const lowerAscii = (value: string): string => value.replace(/[A-Z]/g, (char) => char.toLowerCase())

/** The ISO text an instant is stored as, which compares like time as plain text. */
const ISO_FORMAT = raw("'%Y-%m-%dT%H:%M:%fZ'")

type JsonField = SqlDialect['jsonField']

const postgresJsonField: JsonField = (element, key, type) =>
	type === 'text'
		? sql`(${element} ->> ${raw(`'${jsonKey(key)}'`)})`
		: sql`(${element} ->> ${raw(`'${jsonKey(key)}'`)})::double precision`

const sqliteJsonField: JsonField = (element, key, type) =>
	type === 'text'
		? sql`json_extract(${element}, ${raw(`'$.${jsonKey(key)}'`)})`
		: sql`CAST(json_extract(${element}, ${raw(`'$.${jsonKey(key)}'`)}) AS REAL)`

/** The alias a JSON array's elements are summed under. */
const ELEMENT = 'je'

/** The first of `keys` an element holds, as a number. */
const firstOf = (keys: readonly string[], field: JsonField): SqlFragment =>
	sql`COALESCE(${join(
		keys.map((key) => field(ident(ELEMENT, 'value'), key, 'real')),
		', '
	)})`

const POSTGRES_TYPES: Record<SqlScalar, string> = {
	integer: 'bigint',
	real: 'double precision',
	text: 'text',
}

const SQLITE_TYPES: Record<SqlScalar, string> = {
	integer: 'INTEGER',
	real: 'REAL',
	text: 'TEXT',
}

export const postgresDialect: SqlDialect = {
	name: 'postgres',
	placeholder: (index) => `$${index}`,
	identifier: quote,
	table: (name, schema) => (schema ? `${quote(schema)}.${quote(name)}` : quote(name)),
	timestamp: (value) => value.toISOString(),
	boolean: (value) => value,
	isTrue: (expression) => sql`${expression} IS TRUE`,
	cast: (operand, type) => sql`(${operand})::${raw(POSTGRES_TYPES[type])}`,
	epochMs: (expression) => sql`(EXTRACT(EPOCH FROM ${expression}) * 1000)`,
	afterGap: (later, earlier, minutes) =>
		sql`${later} > ${earlier} + ${raw(`interval '${whole(minutes, 'a gap')} minutes'`)}`,
	within: (a, b, seconds) => {
		const span = raw(`interval '${whole(seconds, 'a span')} seconds'`)
		return sql`${a} BETWEEN ${b} - ${span} AND ${b} + ${span}`
	},
	contains: (expression, value) =>
		sql`${unicodeFolded(expression)} ILIKE ${containsPattern(value)} ${ESCAPE}`,
	matches: (expression, pattern) => sql`${unicodeFolded(expression)} ~* ${pattern}`,
	byCodePoint: (expression) => sql`${expression} COLLATE "C"`,
	crossJoinJsonArray: (expression, alias, elements) =>
		sql`CROSS JOIN LATERAL ${raw(elements === 'text' ? 'jsonb_array_elements_text' : 'jsonb_array_elements')}(${expression}) AS ${ident(alias)}(value)`,
	jsonField: postgresJsonField,
	jsonArrayLength: (expression) => sql`jsonb_array_length(${expression})`,
	jsonArraySum: (expression, keys) =>
		sql`(SELECT SUM(${firstOf(keys, postgresJsonField)}) FROM jsonb_array_elements(${expression}) AS ${ident(ELEMENT)}("value"))`,
	jsonWithout: (expression, key) => sql`(${expression} - ${raw(`'${jsonKey(key)}'`)})`,
	nullSafeEquals: (a, b) => sql`${a} IS NOT DISTINCT FROM ${b}`,
	statementTimeout: (ms) => `SET LOCAL statement_timeout = ${whole(ms, 'a timeout')}`,
	lockTimeout: (ms) => `SET LOCAL lock_timeout = ${whole(ms, 'a timeout')}`,
	idleTimeout: (ms) => `SET LOCAL idle_in_transaction_session_timeout = ${whole(ms, 'a timeout')}`,
	analyticalSettings: ['SET LOCAL jit = off', "SET LOCAL work_mem = '64MB'"],
}

export const sqliteDialect: SqlDialect = {
	name: 'sqlite',
	placeholder: () => '?',
	identifier: quote,
	table: (name) => quote(name),
	timestamp: (value) => value.toISOString(),
	boolean: (value) => (value ? 1 : 0),
	isTrue: (expression) => sql`${expression} = 1`,
	cast: (operand, type) => sql`CAST(${operand} AS ${raw(SQLITE_TYPES[type])})`,
	epochMs: (expression) => sql`((julianday(${expression}) - 2440587.5) * 86400000.0)`,
	// Compared as text: julianday's floating point cannot tell exactly 30 minutes from 30 and a hair.
	afterGap: (later, earlier, minutes) =>
		sql`${later} > strftime(${ISO_FORMAT}, ${earlier}, ${raw(`'+${whole(minutes, 'a gap')} minutes'`)})`,
	within: (a, b, seconds) => {
		const span = whole(seconds, 'a span')
		return sql`${a} BETWEEN strftime(${ISO_FORMAT}, ${b}, ${raw(`'-${span} seconds'`)}) AND strftime(${ISO_FORMAT}, ${b}, ${raw(`'+${span} seconds'`)})`
	},
	// Folds ASCII letters only, where Postgres' ILIKE folds every letter.
	contains: (expression, value) =>
		sql`lower(${expression}) LIKE ${lowerAscii(containsPattern(value))} ${ESCAPE}`,
	matches: null,
	byCodePoint: (expression) => expression,
	crossJoinJsonArray: (expression, alias) =>
		sql`CROSS JOIN json_each(${expression}) AS ${ident(alias)}`,
	jsonField: sqliteJsonField,
	jsonArrayLength: (expression) => sql`json_array_length(${expression})`,
	jsonArraySum: (expression, keys) =>
		sql`(SELECT SUM(${firstOf(keys, sqliteJsonField)}) FROM json_each(${expression}) AS ${ident(ELEMENT)})`,
	jsonWithout: (expression, key) => sql`json_remove(${expression}, ${raw(`'$.${jsonKey(key)}'`)})`,
	nullSafeEquals: (a, b) => sql`${a} IS ${b}`,
	statementTimeout: () => null,
	lockTimeout: (ms) => `PRAGMA busy_timeout = ${whole(ms, 'a timeout')}`,
	idleTimeout: () => null,
	analyticalSettings: [],
}
