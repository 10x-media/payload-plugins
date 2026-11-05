import type { SqlDialect } from '../dialect'

/** A value bound as a parameter. A Date binds as ISO text, a boolean as the dialect stores it. */
export type SqlValue = string | number | bigint | boolean | Date | null

/** What a compiled statement binds: what each driver accepts for every dialect. */
export type SqlParameter = string | number | bigint | boolean | null

type Piece =
	| { kind: 'text'; text: string }
	| { kind: 'value'; value: SqlValue }
	| { kind: 'json'; value: unknown }
	| { kind: 'identifier'; names: readonly string[] }
	| { kind: 'fragment'; fragment: SqlFragment }

/**
 * A piece of SQL with its parameters kept apart from its text until it is compiled for one
 * dialect, so the same statement numbers `$1, $2` on Postgres and writes `?` on SQLite.
 */
export class SqlFragment {
	readonly pieces: readonly Piece[]

	constructor(pieces: readonly Piece[]) {
		this.pieces = pieces
	}
}

export interface CompiledSql {
	text: string
	values: SqlParameter[]
}

/** Anything a template may interpolate: a value to bind, or SQL already built. */
export type SqlArgument = SqlValue | SqlFragment

/** Tagged template: every interpolated value becomes a parameter, every fragment is spliced in. */
export const sql = (
	strings: TemplateStringsArray,
	...args: readonly SqlArgument[]
): SqlFragment => {
	const pieces: Piece[] = []
	strings.forEach((text, i) => {
		if (text !== '') {
			pieces.push({ kind: 'text', text })
		}
		if (i < args.length) {
			const arg = args[i] ?? null
			pieces.push(
				arg instanceof SqlFragment
					? { kind: 'fragment', fragment: arg }
					: { kind: 'value', value: arg }
			)
		}
	})
	return new SqlFragment(pieces)
}

/**
 * SQL text as it is: keywords, and what the dialect helpers build. Never a value a request
 * carried, which would be SQL injection; those go through {@link sql} as parameters.
 */
export const raw = (text: string): SqlFragment => new SqlFragment([{ kind: 'text', text }])

/** `NULL` written into the text rather than bound, so it costs no parameter. */
export const NULL = raw('NULL')

/** An identifier, quoted for the dialect; several names make a qualified one (`t.col`). */
export const ident = (...names: readonly string[]): SqlFragment =>
	new SqlFragment([{ kind: 'identifier', names }])

/** A value bound as JSON text, read as `jsonb` on Postgres. */
export const json = (value: unknown): SqlFragment => new SqlFragment([{ kind: 'json', value }])

export const join = (fragments: readonly SqlFragment[], separator = ', '): SqlFragment => {
	const pieces: Piece[] = []
	fragments.forEach((fragment, i) => {
		if (i > 0) {
			pieces.push({ kind: 'text', text: separator })
		}
		pieces.push({ kind: 'fragment', fragment })
	})
	return new SqlFragment(pieces)
}

/** Each value bound as a parameter of its own, comma separated: the list inside `IN (...)`. */
export const valueList = (values: readonly SqlArgument[]): SqlFragment =>
	join(values.map((value) => sql`${value}`))

const bind = (value: SqlValue, dialect: SqlDialect): SqlParameter => {
	if (value instanceof Date) {
		if (Number.isNaN(value.getTime())) {
			throw new Error('analytics: an invalid date cannot be bound')
		}
		return dialect.timestamp(value)
	}
	if (typeof value === 'boolean') {
		return dialect.boolean(value)
	}
	if (typeof value === 'number' && !Number.isFinite(value)) {
		throw new Error(`analytics: ${value} cannot be bound`)
	}
	return value
}

/** The text and the parameters of a fragment for one dialect, placeholders numbered in order. */
export const compile = (fragment: SqlFragment, dialect: SqlDialect): CompiledSql => {
	const values: SqlParameter[] = []
	const parameter = (value: SqlParameter): string => {
		values.push(value)
		return dialect.placeholder(values.length)
	}
	const write = (current: SqlFragment): string => {
		let text = ''
		for (const piece of current.pieces) {
			if (piece.kind === 'text') {
				text += piece.text
			} else if (piece.kind === 'identifier') {
				text += piece.names.map((name) => dialect.identifier(name)).join('.')
			} else if (piece.kind === 'fragment') {
				text += write(piece.fragment)
			} else if (piece.kind === 'json') {
				const placeholder = parameter(JSON.stringify(piece.value) ?? null)
				text += dialect.name === 'postgres' ? `${placeholder}::jsonb` : placeholder
			} else {
				text += parameter(bind(piece.value, dialect))
			}
		}
		return text
	}
	return { text: write(fragment), values }
}
