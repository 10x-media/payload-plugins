import { describe, expect, it } from 'vitest'
import { dayWindow, planAggregateRead } from '../aggregate'
import { DEFAULT_CAPS } from '../caps'
import { postgresDialect, type SqlDialect, sqliteDialect } from '../dialect'
import { generationRowId } from '../ids'
import type { AggregateRead } from '../types'
import {
	type AggregateTarget,
	compileAggregateInsert,
	compileAggregateRead,
	compileDayAggregation,
	compileDayGens,
	compileDayRowsDelete,
} from './aggregateSql'
import { compile, raw, type SqlFragment } from './fragment'

const DIALECTS: readonly SqlDialect[] = [postgresDialect, sqliteDialect]

const targetOf = (dialect: SqlDialect): AggregateTarget => {
	const table = (name: string) =>
		raw(dialect.name === 'postgres' ? `"analytics"."${name}"` : `"${name}"`)
	return {
		dialect,
		hits: table('analytics_hits'),
		aggregates: table('analytics_aggregates'),
		state: table('analytics_state'),
	}
}

const WINDOW = dayWindow('tenant-a', 20261006, 'Europe/Berlin')

const golden = (fragment: SqlFragment, dialect: SqlDialect): string => {
	const { text, values } = compile(fragment, dialect)
	const parameters = values.map((value, i) => `-- ${i + 1}: ${JSON.stringify(value)}`)
	return `${text}\n\n-- parameters\n${parameters.join('\n')}\n`
}

const READS: ReadonlyArray<[string, AggregateRead]> = [
	[
		'aggregate-total',
		{ scope: 'tenant-a', days: [[20261001, 20261030]], dim: '', groupBy: 'total' },
	],
	[
		'aggregate-series',
		{
			scope: 'tenant-a',
			days: [
				[20261001, 20261003],
				[20261010, 20261010],
			],
			hostname: 'a.example',
			dim: '',
			groupBy: 'day',
		},
	],
	[
		'aggregate-top-pages',
		{
			scope: 'tenant-a',
			days: [[20261001, 20261030]],
			dim: 'page',
			groupBy: 'value',
			order: { part: 'pageviews', dir: 'desc' },
			limit: 10,
		},
	],
	[
		'aggregate-goal-sources-filled',
		{
			days: [[20261001, 20261030]],
			dim: 'goal',
			value: 'purchase',
			dim2: 'source',
			groupBy: 'value2',
			values: ['google', 'bing'],
			order: { part: 'revenue', per: 'conversions', dir: 'desc' },
		},
	],
]

describe('aggregation SQL goldens', () => {
	for (const dialect of DIALECTS) {
		it(`a day's read on ${dialect.name}`, async () => {
			await expect(
				golden(
					compileDayAggregation(WINDOW, targetOf(dialect), { itemPages: true, caps: DEFAULT_CAPS }),
					dialect
				)
			).toMatchFileSnapshot(`./__golden__/day-aggregation.${dialect.name}.sql`)
		})
		it(`a day's write on ${dialect.name}`, async () => {
			const target = targetOf(dialect)
			const statements = [
				golden(compileDayGens(WINDOW, target), dialect),
				golden(
					compileAggregateInsert(
						[
							{
								id: 'ID1',
								scope: 'tenant-a',
								day: 20261006,
								hostname: 'a.example',
								dim: 'page',
								value: '/pricing',
								dim2: '',
								value2: '',
								gen: 'G1',
								parts: {
									pageviews: 3,
									events: 1,
									visitors: 2,
									sessions: 2,
									entries: 1,
									bounces: 0,
									sessionMs: 9000,
									durationMs: 4000,
									scrollSum: 80,
									scrollSamples: 2,
									conversions: 0,
									revenue: 0,
									impressions: null,
									interactions: 0,
								},
							},
						],
						target
					),
					dialect
				),
				golden(compileDayRowsDelete(WINDOW, { gens: ['G0'], limit: 2_000 }, target), dialect),
				golden(compileDayRowsDelete(WINDOW, { keep: 'G1', limit: 2_000 }, target), dialect),
			]
			await expect(statements.join('\n')).toMatchFileSnapshot(
				`./__golden__/day-write.${dialect.name}.sql`
			)
		})
		for (const [name, read] of READS) {
			it(`${name} on ${dialect.name}`, async () => {
				await expect(
					golden(compileAggregateRead(planAggregateRead(read), targetOf(dialect)), dialect)
				).toMatchFileSnapshot(`./__golden__/${name}.${dialect.name}.sql`)
			})
		}
	}
})

describe('aggregation SQL shape', () => {
	const text = (dialect: SqlDialect, itemPages = true): string =>
		compile(
			compileDayAggregation(WINDOW, targetOf(dialect), { itemPages, caps: DEFAULT_CAPS }),
			dialect
		).text

	it('reads the day once, cuts its visits once, and fans every kind out of that', () => {
		for (const dialect of DIALECTS) {
			const sql = text(dialect)
			expect(sql.match(/FROM "?a"? AS "t"/g)?.length).toBeGreaterThan(0)
			expect(sql.match(/h AS \(SELECT/g)).toHaveLength(1)
			expect(sql).toContain('"t"."server"')
		}
	})

	it('leaves the item by page kind out entirely when the install keeps no item pages', () => {
		expect(text(sqliteDialect, true)).toContain('VALUES (23), (24)')
		expect(text(sqliteDialect, false)).toContain('VALUES (23))')
		expect(text(sqliteDialect, false)).not.toContain('(24)')
	})

	it('writes each generation under ids of its own, beside the rows reads still count', () => {
		const record = {
			id: 'ID1',
			scope: 'tenant-a',
			day: 20261006,
			hostname: 'a.example',
			dim: 'page' as const,
			value: '/a',
			dim2: '' as const,
			value2: '',
			gen: 'G2',
			parts: {
				pageviews: 1,
				events: 0,
				visitors: 1,
				sessions: 1,
				entries: 1,
				bounces: 1,
				sessionMs: 0,
				durationMs: 0,
				scrollSum: 0,
				scrollSamples: 0,
				conversions: 0,
				revenue: 0,
				impressions: null,
				interactions: 0,
			},
		}
		const { text: sql, values } = compile(
			compileAggregateInsert([record], targetOf(postgresDialect)),
			postgresDialect
		)
		expect(values[0]).toBe(generationRowId({ id: 'ID1', gen: 'G2' }))
		expect(values[0]).toHaveLength(22)
		expect(values[0]).not.toBe(generationRowId({ id: 'ID1', gen: 'G3' }))
		expect(sql).toContain('DO NOTHING')
		expect(sql).not.toContain('DO UPDATE')
	})

	it('binds every value a read carries', () => {
		const { text: sql, values } = compile(
			compileAggregateRead(
				planAggregateRead({
					scope: "a'; DROP TABLE x; --",
					days: [[20261001, 20261002]],
					dim: 'page',
					groupBy: 'value',
					values: ["'; --"],
					hostname: "h' OR '1'='1",
				}),
				targetOf(postgresDialect)
			),
			postgresDialect
		)
		expect(sql).not.toContain('DROP TABLE')
		expect(sql).not.toContain("'1'='1")
		expect(values).toEqual(
			expect.arrayContaining(["a'; DROP TABLE x; --", "'; --", "h' OR '1'='1"])
		)
	})
})
