import { describe, expect, it } from 'vitest'
import { postgresDialect, sqliteDialect } from '../dialect'
import { compile, ident, join, json, raw, sql } from './fragment'

describe('sql fragments', () => {
	const scope = 'alpha'
	const start = new Date('2026-10-05T00:00:00.000Z')
	const statement = sql`SELECT ${ident('h', 'path')} FROM ${raw('"analytics_hits"')} AS h WHERE scope = ${scope} AND ts >= ${start}`

	it('numbers placeholders on Postgres and writes ? on SQLite, binding the same values', () => {
		expect(compile(statement, postgresDialect)).toEqual({
			text: 'SELECT "h"."path" FROM "analytics_hits" AS h WHERE scope = $1 AND ts >= $2',
			values: ['alpha', '2026-10-05T00:00:00.000Z'],
		})
		expect(compile(statement, sqliteDialect)).toEqual({
			text: 'SELECT "h"."path" FROM "analytics_hits" AS h WHERE scope = ? AND ts >= ?',
			values: ['alpha', '2026-10-05T00:00:00.000Z'],
		})
	})

	it('numbers on through nested fragments in order', () => {
		const inner = sql`v = ${'x'} OR v = ${'y'}`
		const outer = sql`SELECT 1 WHERE a = ${1} AND (${inner}) AND b = ${2}`
		expect(compile(outer, postgresDialect)).toEqual({
			text: 'SELECT 1 WHERE a = $1 AND (v = $2 OR v = $3) AND b = $4',
			values: [1, 'x', 'y', 2],
		})
	})

	it('joins fragments with a separator, numbering across them', () => {
		const rows = [sql`(${1}, ${'a'})`, sql`(${2}, ${'b'})`]
		expect(compile(sql`INSERT INTO t VALUES ${join(rows)}`, postgresDialect)).toEqual({
			text: 'INSERT INTO t VALUES ($1, $2), ($3, $4)',
			values: [1, 'a', 2, 'b'],
		})
		expect(compile(join([ident('a'), ident('b')], ' AND '), sqliteDialect).text).toBe('"a" AND "b"')
	})

	it('binds JSON as text, read as jsonb on Postgres', () => {
		const statement = sql`UPDATE t SET goals = ${json([{ slug: 'buy', value: 9 }])}`
		expect(compile(statement, postgresDialect)).toEqual({
			text: 'UPDATE t SET goals = $1::jsonb',
			values: ['[{"slug":"buy","value":9}]'],
		})
		expect(compile(statement, sqliteDialect)).toEqual({
			text: 'UPDATE t SET goals = ?',
			values: ['[{"slug":"buy","value":9}]'],
		})
	})

	it('binds booleans, nulls and bigints as each database takes them', () => {
		const statement = sql`VALUES (${true}, ${false}, ${null}, ${10n})`
		expect(compile(statement, postgresDialect).values).toEqual([true, false, null, 10n])
		expect(compile(statement, sqliteDialect).values).toEqual([1, 0, null, 10n])
	})

	it('never inlines a value, whatever it holds', () => {
		const hostile = "x'; DROP TABLE analytics_hits; --"
		const compiled = compile(sql`SELECT 1 WHERE v = ${hostile}`, sqliteDialect)
		expect(compiled.text).toBe('SELECT 1 WHERE v = ?')
		expect(compiled.values).toEqual([hostile])
	})

	it('refuses a value no database would read back as itself', () => {
		expect(() => compile(sql`SELECT ${Number.NaN}`, postgresDialect)).toThrow()
		expect(() => compile(sql`SELECT ${Number.POSITIVE_INFINITY}`, postgresDialect)).toThrow()
		expect(() => compile(sql`SELECT ${new Date(Number.NaN)}`, sqliteDialect)).toThrow()
	})

	it('compiles a template with nothing interpolated', () => {
		expect(compile(sql`SELECT 1`, postgresDialect)).toEqual({ text: 'SELECT 1', values: [] })
	})
})
