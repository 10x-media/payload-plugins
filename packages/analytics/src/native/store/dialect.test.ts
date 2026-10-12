import { describe, expect, it } from 'vitest'
import {
	containsPattern,
	sqliteDialect as lite,
	postgresDialect as pg,
	type SqlDialect,
} from './dialect'
import { compile, ident, type SqlFragment } from './sql/fragment'

const text = (fragment: SqlFragment, dialect: SqlDialect): string => compile(fragment, dialect).text

const col = (name: string): SqlFragment => ident(name)

describe('dialect goldens', () => {
	it('numbers parameters on Postgres and writes ? on SQLite', () => {
		expect(pg.placeholder(1)).toBe('$1')
		expect(pg.placeholder(12)).toBe('$12')
		expect(lite.placeholder(12)).toBe('?')
	})

	it('quotes identifiers the same way on both, doubling a quote inside', () => {
		expect(pg.identifier('last_at')).toBe('"last_at"')
		expect(lite.identifier('we"ird')).toBe('"we""ird"')
	})

	it('qualifies a table with its schema on Postgres alone', () => {
		expect(pg.table('analytics_hits', 'tenant_data')).toBe('"tenant_data"."analytics_hits"')
		expect(pg.table('analytics_hits')).toBe('"analytics_hits"')
		expect(lite.table('analytics_hits', 'main')).toBe('"analytics_hits"')
	})

	it('binds an instant as ISO text on both, which SQLite compares as text', () => {
		const at = new Date('2026-10-05T12:00:00.000Z')
		expect(pg.timestamp(at)).toBe('2026-10-05T12:00:00.000Z')
		expect(lite.timestamp(at)).toBe('2026-10-05T12:00:00.000Z')
	})

	it('binds and tests booleans as each stores them', () => {
		expect(pg.boolean(true)).toBe(true)
		expect(lite.boolean(true)).toBe(1)
		expect(lite.boolean(false)).toBe(0)
		expect(text(pg.isTrue(ident('h', 'landing')), pg)).toBe('"h"."landing" IS TRUE')
		expect(text(lite.isTrue(ident('h', 'landing')), lite)).toBe('"h"."landing" = 1')
	})

	it('casts with :: on Postgres and CAST on SQLite, a value bound either way', () => {
		expect(text(pg.cast(col('n'), 'integer'), pg)).toBe('("n")::bigint')
		expect(text(pg.cast(col('n'), 'real'), pg)).toBe('("n")::double precision')
		expect(compile(pg.cast('7', 'text'), pg)).toEqual({ text: '($1)::text', values: ['7'] })
		expect(text(lite.cast(col('n'), 'integer'), lite)).toBe('CAST("n" AS INTEGER)')
		expect(compile(lite.cast(1.5, 'real'), lite)).toEqual({
			text: 'CAST(? AS REAL)',
			values: [1.5],
		})
	})

	it('measures time in epoch milliseconds: EXTRACT on Postgres, julianday on SQLite', () => {
		expect(text(pg.epochMs(col('ts')), pg)).toBe('(EXTRACT(EPOCH FROM "ts") * 1000)')
		expect(text(lite.epochMs(col('ts')), lite)).toBe('((julianday("ts") - 2440587.5) * 86400000.0)')
	})

	it('compares a gap with interval arithmetic on Postgres and ISO text on SQLite', () => {
		expect(text(pg.afterGap(col('ts'), col('prev_act'), 30), pg)).toBe(
			`"ts" > "prev_act" + interval '30 minutes'`
		)
		expect(text(lite.afterGap(col('ts'), col('prev_act'), 30), lite)).toBe(
			`"ts" > strftime('%Y-%m-%dT%H:%M:%fZ', "prev_act", '+30 minutes')`
		)
	})

	it('matches a substring with ILIKE on Postgres and lowered LIKE on SQLite, the pattern bound', () => {
		expect(compile(pg.contains(col('path'), '50%_off'), pg)).toEqual({
			text: `("path") COLLATE "default" ILIKE $1 ESCAPE '\\'`,
			values: ['%50\\%\\_off%'],
		})
		expect(compile(lite.contains(col('path'), 'Blog_É'), lite)).toEqual({
			text: `lower("path") LIKE ? ESCAPE '\\'`,
			values: ['%blog\\_É%'],
		})
		expect(containsPattern('a\\b')).toBe('%a\\\\b%')
	})

	it('matches a regular expression on Postgres alone', () => {
		expect(compile(pg.matches?.(col('path'), '^/blog/') ?? col('none'), pg)).toEqual({
			text: '("path") COLLATE "default" ~* $1',
			values: ['^/blog/'],
		})
		expect(lite.matches).toBeNull()
	})

	it('orders text by code point: the C collation on Postgres, the default on SQLite', () => {
		expect(text(pg.byCodePoint(col('value')), pg)).toBe('"value" COLLATE "C"')
		expect(text(lite.byCodePoint(col('value')), lite)).toBe('"value"')
	})

	it('unnests a JSON array with jsonb functions on Postgres and json_each on SQLite', () => {
		expect(text(pg.crossJoinJsonArray(ident('a', 'impressions'), 'i', 'text'), pg)).toBe(
			'CROSS JOIN LATERAL jsonb_array_elements_text("a"."impressions") AS "i"(value)'
		)
		expect(text(pg.crossJoinJsonArray(ident('a', 'goals'), 'g', 'json'), pg)).toBe(
			'CROSS JOIN LATERAL jsonb_array_elements("a"."goals") AS "g"(value)'
		)
		expect(text(lite.crossJoinJsonArray(ident('a', 'goals'), 'g', 'json'), lite)).toBe(
			'CROSS JOIN json_each("a"."goals") AS "g"'
		)
		expect(text(pg.jsonField(ident('g', 'value'), 'slug', 'text'), pg)).toBe(
			`("g"."value" ->> 'slug')`
		)
		expect(text(pg.jsonField(ident('g', 'value'), 'value', 'real'), pg)).toBe(
			`("g"."value" ->> 'value')::double precision`
		)
		expect(text(lite.jsonField(ident('g', 'value'), 'slug', 'text'), lite)).toBe(
			`json_extract("g"."value", '$.slug')`
		)
		expect(text(lite.jsonField(ident('g', 'value'), 'value', 'real'), lite)).toBe(
			`CAST(json_extract("g"."value", '$.value') AS REAL)`
		)
	})

	it('compares nulls as equal with IS NOT DISTINCT FROM on Postgres and IS on SQLite', () => {
		expect(compile(pg.nullSafeEquals(col('ref'), null), pg)).toEqual({
			text: '"ref" IS NOT DISTINCT FROM $1',
			values: [null],
		})
		expect(compile(lite.nullSafeEquals(col('ref'), 'x.com'), lite)).toEqual({
			text: '"ref" IS ?',
			values: ['x.com'],
		})
	})

	it('bounds statements and idle transactions on Postgres, and lock waits on both', () => {
		expect(pg.statementTimeout(5000)).toBe('SET LOCAL statement_timeout = 5000')
		expect(lite.statementTimeout(5000)).toBeNull()
		expect(pg.lockTimeout(5000)).toBe('SET LOCAL lock_timeout = 5000')
		expect(lite.lockTimeout(5000)).toBe('PRAGMA busy_timeout = 5000')
		expect(pg.idleTimeout(60_000)).toBe('SET LOCAL idle_in_transaction_session_timeout = 60000')
		expect(lite.idleTimeout(60_000)).toBeNull()
	})

	it('writes nothing it was not given a whole number or a plain key for', () => {
		expect(() => pg.afterGap(col('a'), col('b'), 1.5)).toThrow(/whole number/)
		expect(() => lite.lockTimeout(-1)).toThrow(/whole number/)
		expect(() => pg.statementTimeout(Number.NaN)).toThrow(/whole number/)
		expect(() => pg.idleTimeout(0.5)).toThrow(/whole number/)
		expect(() => pg.jsonField(col('g'), "slug'); DROP TABLE x; --", 'text')).toThrow(/JSON key/)
	})
})
