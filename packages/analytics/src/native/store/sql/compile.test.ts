import { describe, expect, it } from 'vitest'
import { postgresDialect, type SqlDialect, sqliteDialect } from '../dialect'
import { planRawRead, rawFilterMap } from '../rawRead'
import type { RawRead } from '../types'
import {
	compileHasHits,
	compileRangeCount,
	compileRawRead,
	compileScopes,
	type SqlTarget,
} from './compile'
import { compile, raw, type SqlFragment } from './fragment'

const DIALECTS: readonly SqlDialect[] = [postgresDialect, sqliteDialect]

const targetOf = (dialect: SqlDialect): SqlTarget => ({
	dialect,
	hits: raw(dialect.name === 'postgres' ? '"analytics"."analytics_hits"' : '"analytics_hits"'),
})

const DAY = new Date('2026-10-06T00:00:00.000Z')
const NEXT = new Date('2026-10-07T00:00:00.000Z')
const hour = (h: number): Date => new Date(DAY.getTime() + h * 3_600_000)

const base: RawRead = {
	scope: 'tenant-a',
	start: DAY,
	end: NEXT,
	filters: [],
	sessions: false,
	timeoutMs: 5000,
}

/** One read of each shape the planner sends, by golden file name. */
const READS: ReadonlyArray<[string, RawRead]> = [
	['total', base],
	['visits-by-hour', { ...base, sessions: true, buckets: [hour(0), hour(6), hour(12), hour(18)] }],
	[
		'sources-filtered-top',
		{
			...base,
			from: DAY,
			start: hour(9),
			hostname: 'a.example',
			sessions: true,
			groupBy: 'source',
			filters: [
				{ dimension: 'source', operator: 'contains', value: '50%_Off' },
				{ dimension: 'page', operator: 'eq', value: '/pricing' },
			],
			order: { part: 'pageviews', dir: 'desc' },
			limit: 5,
		},
	],
	[
		'goals-by-channel',
		{
			...base,
			groupBy: 'channel',
			filters: [{ dimension: 'goal', operator: 'eq', value: 'purchase' }],
		},
	],
	['item-pages', { ...base, item: 'offers:1', groupBy: 'page' }],
	[
		'pages-filled-by-time-per-view',
		{
			...base,
			groupBy: 'page',
			values: ['/a', '/b'],
			order: { part: 'durationMs', per: 'pageviews', dir: 'desc' },
		},
	],
	['every-scope-visits', { ...base, scope: undefined, sessions: true }],
	[
		'pages-of-a-country',
		{
			...base,
			groupBy: 'page',
			filters: [{ dimension: 'country', operator: 'eq', value: 'DE' }],
			order: { part: 'pageviews', dir: 'desc' },
			limit: 10,
		},
	],
	[
		'live-sources',
		{
			...base,
			from: DAY,
			start: hour(18),
			end: new Date(hour(18).getTime() + 30 * 60_000),
			groupBy: 'source',
			order: { part: 'visitors', dir: 'desc' },
			limit: 10,
		},
	],
]

const golden = (fragment: SqlFragment, dialect: SqlDialect): string => {
	const { text, values } = compile(fragment, dialect)
	const parameters = values.map((value, i) => `-- ${i + 1}: ${JSON.stringify(value)}`)
	return `${text}\n\n-- parameters\n${parameters.join('\n')}\n`
}

const statementOf = (read: RawRead, dialect: SqlDialect): SqlFragment =>
	compileRawRead(
		planRawRead(read, { id: dialect.name, filters: rawFilterMap(['eq', 'contains', 'matches']) }),
		targetOf(dialect)
	)

describe('compileRawRead goldens', () => {
	for (const dialect of DIALECTS) {
		for (const [name, read] of READS) {
			it(`${name} on ${dialect.name}`, async () => {
				await expect(golden(statementOf(read, dialect), dialect)).toMatchFileSnapshot(
					`./__golden__/${name}.${dialect.name}.sql`
				)
			})
		}
		it(`window, scope and index statements on ${dialect.name}`, async () => {
			const target = targetOf(dialect)
			const statements = [
				golden(compileHasHits({ scope: 's', start: DAY, end: NEXT }, target), dialect),
				golden(compileScopes(target), dialect),
				golden(compileRangeCount({ scope: 's', start: DAY, end: NEXT }, target, 1000), dialect),
			]
			await expect(statements.join('\n')).toMatchFileSnapshot(
				`./__golden__/windows.${dialect.name}.sql`
			)
		})
	}
})

describe('compileRawRead shape', () => {
	const text = (read: RawRead, dialect: SqlDialect): string =>
		compile(statementOf(read, dialect), dialect).text

	it('cuts visits with the 30 minute gap frame, ordered by time and then id by code point', () => {
		const postgres = text({ ...base, sessions: true }, postgresDialect)
		expect(postgres).toContain(
			'PARTITION BY "hostname", "v" ORDER BY "ts", "id" COLLATE "C" ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING'
		)
		expect(postgres).toContain(`"ts" > MAX("act") OVER gap + interval '30 minutes'`)
		const sqlite = text({ ...base, sessions: true }, sqliteDialect)
		expect(sqlite).toContain(
			'PARTITION BY "hostname", "v" ORDER BY "ts", "id" ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING'
		)
		expect(sqlite).toContain(
			`"ts" > strftime('%Y-%m-%dT%H:%M:%fZ', MAX("act") OVER gap, '+30 minutes')`
		)
	})

	it('joins visits back on SQLite alone, and partitions by scope only across scopes', () => {
		const sources = { ...base, groupBy: 'source' as const }
		expect(text(sources, postgresDialect)).not.toContain('JOIN')
		expect(text(sources, sqliteDialect)).toContain('LEFT JOIN va ON')
		expect(text({ ...base, scope: undefined, sessions: true }, postgresDialect)).toContain(
			'PARTITION BY "scope", "hostname", "v"'
		)
	})

	it('carries only the visit attributes a read takes, and no landing without an acquisition one', () => {
		for (const dialect of DIALECTS) {
			const visits = text({ ...base, sessions: true }, dialect)
			expect(visits).not.toContain('"e_')
			expect(visits).not.toContain('JOIN')
			expect(visits).not.toContain('OVER land')
			const countries = text({ ...base, groupBy: 'country' }, dialect)
			expect(countries).toContain('"e_country"')
			expect(countries).not.toContain('"e_source"')
			expect(countries).not.toContain('OVER land')
			const sources = text(
				{
					...base,
					groupBy: 'source',
					filters: [{ dimension: 'device', operator: 'eq', value: 'mobile' }],
				},
				dialect
			)
			expect(sources).toContain('FIRST_VALUE("source") OVER land')
			expect(sources).toContain('"e_device"')
			expect(sources).not.toContain('"e_country"')
		}
	})

	it('compares keys byte by byte on Postgres, and folds case by the database collation', () => {
		const postgres = text(
			{
				...base,
				groupBy: 'source',
				filters: [{ dimension: 'page', operator: 'contains', value: 'Über' }],
			},
			postgresDialect
		)
		expect(postgres).toContain('"hostname" COLLATE "C" AS "hostname"')
		expect(postgres).toContain('"path" COLLATE "C" AS "path"')
		expect(postgres).toContain('"source" COLLATE "C" AS "source"')
		expect(postgres).toContain('("t"."path") COLLATE "default" ILIKE $')
		const sqlite = text({ ...base, groupBy: 'source' }, sqliteDialect)
		expect(sqlite).not.toContain('COLLATE')
	})

	it('reads the hits once, with no visit chain when nothing needs one', () => {
		for (const dialect of DIALECTS) {
			const plain = text(base, dialect)
			expect(plain).not.toContain('OVER')
			expect(plain.match(/analytics_hits"? AS "hit"/g)).toHaveLength(1)
		}
	})

	// Only an order's record looks its twin up, by primary key; every other row skips it.
	it("credits an `ow.` row with its stored server twin's sale within the window, and leaves that twin out", () => {
		const within = {
			postgres:
				' AND "twin"."ts" BETWEEN "hit"."ts" - interval \'86400 seconds\' AND "hit"."ts" + interval \'86400 seconds\'',
			sqlite: ` AND "twin"."ts" BETWEEN strftime('%Y-%m-%dT%H:%M:%fZ', "hit"."ts", '-86400 seconds') AND strftime('%Y-%m-%dT%H:%M:%fZ', "hit"."ts", '+86400 seconds')`,
		}
		for (const dialect of DIALECTS) {
			const plain = text(base, dialect)
			const close = within[dialect.name]
			expect(plain).toContain(
				`CASE WHEN substr("hit"."id", 1, 3) <> 'ow.' THEN "conversions"\n\t\t\tWHEN (SELECT 1 FROM`
			)
			expect(plain).toContain(
				`WHERE "twin"."id" = 'os.' || substr("hit"."id", 4)) IS NULL THEN "revenue"\n\t\t\tELSE (SELECT "revenue" FROM`
			)
			expect(plain).toContain(
				`WHERE "twin"."id" = 'os.' || substr("hit"."id", 4)${close}) END AS "revenue"`
			)
			expect(plain).toContain(`AND (substr("hit"."id", 1, 3) <> 'os.'\n\t\t\tOR (SELECT 1 FROM`)
			expect(plain).toContain(
				`WHERE "twin"."id" = 'ow.' || substr("hit"."id", 4)${close}) IS NULL)`
			)
			expect(plain).toContain(`THEN COALESCE((SELECT "item" FROM`)
			expect(plain).not.toContain('EXISTS')
		}
	})

	it('takes an order twin at any distance when the window is off', () => {
		for (const dialect of DIALECTS) {
			const plan = planRawRead(base, {
				id: dialect.name,
				filters: rawFilterMap(['eq', 'contains', 'matches']),
			})
			const { text: sql } = compile(
				compileRawRead(plan, { ...targetOf(dialect), twinWindowMs: null }),
				dialect
			)
			expect(sql).toContain(`WHERE "twin"."id" = 'os.' || substr("hit"."id", 4)) END AS "revenue"`)
			expect(sql).not.toContain('BETWEEN')
		}
	})

	it('selects money as it was sent only for a read that names the currency', () => {
		for (const dialect of DIALECTS) {
			expect(text(base, dialect)).not.toContain('sent_currency')
			const grouped = text({ ...base, groupBy: 'currency' }, dialect)
			expect(grouped).toContain('ELSE (SELECT COALESCE("original_currency", "currency") FROM')
			expect(grouped).toMatch(/END( COLLATE "C")? AS "sent_currency"/)
			expect(grouped).toContain('"t"."sent_currency" AS "gv"')
			expect(grouped).toContain('COALESCE("t"."sent_revenue", 0) AS "revenue"')
			const filtered = text(
				{ ...base, filters: [{ dimension: 'currency', operator: 'eq', value: 'USD' }] },
				dialect
			)
			expect(filtered).toMatch(/"t"\."sent_currency" = (\$\d+|\?)/)
			expect(filtered).toContain('COALESCE("t"."sent_revenue", 0) AS "revenue"')
		}
	})

	it('binds every value a read carries, and writes only constants into the text', () => {
		const { text: sql, values } = compile(
			statementOf(
				{
					...base,
					hostname: "a'; DROP TABLE x; --",
					groupBy: 'page',
					filters: [{ dimension: 'event', operator: 'eq', value: "x' OR '1'='1" }],
					values: ["'; --"],
					limit: 3,
				},
				postgresDialect
			),
			postgresDialect
		)
		expect(sql).not.toContain('DROP TABLE')
		expect(sql).not.toContain("'1'='1")
		expect(values).toEqual(
			expect.arrayContaining(["a'; DROP TABLE x; --", "x' OR '1'='1", "'; --", 3])
		)
	})

	it('has no regular expressions on SQLite to filter with', () => {
		expect(() =>
			statementOf(
				{ ...base, filters: [{ dimension: 'page', operator: 'matches', value: '^/' }] },
				sqliteDialect
			)
		).toThrow(/no regular expressions/)
		expect(
			text(
				{ ...base, filters: [{ dimension: 'page', operator: 'matches', value: '^/' }] },
				postgresDialect
			)
		).toContain('("t"."path") COLLATE "default" ~* $')
	})

	it('writes an impossible condition for an empty exact fill', () => {
		expect(text({ ...base, groupBy: 'page', values: [] }, sqliteDialect)).toContain('1 = 0')
	})

	it('keeps the visitors with a hit passing a filter before cutting visits, by scope across scopes', () => {
		const country = [{ dimension: 'country', operator: 'eq', value: 'DE' }] as const
		for (const dialect of DIALECTS) {
			const scoped = text({ ...base, filters: country }, dialect)
			expect(scoped).toContain('AND ("hostname", "v") IN (SELECT "hostname", "v" FROM')
			expect(scoped).toMatch(/AND "country" = (\$\d+|\?)\)\n\t+AND \(substr\("hit"\."id"/)
			expect(scoped.indexOf(' IN (SELECT "hostname", "v"')).toBeLessThan(scoped.indexOf('g AS ('))
			const every = text({ ...base, scope: undefined, filters: country }, dialect)
			expect(every).toContain('AND ("scope", "hostname", "v") IN (SELECT "scope", "hostname", "v"')
			expect(
				text({ ...base, filters: country, sessions: false, groupBy: 'page' }, dialect)
			).toContain(' IN (SELECT')
			expect(text({ ...base, sessions: true }, dialect)).not.toContain(' IN (SELECT')
			expect(
				text({ ...base, filters: [{ dimension: 'page', operator: 'eq', value: '/a' }] }, dialect)
			).not.toContain(' IN (SELECT')
		}
	})

	it('tests a hit for each kind of filter, a goal by any completion and an item not at all', () => {
		const filtered = (filter: RawRead['filters'][number]) =>
			text({ ...base, sessions: true, filters: [filter] }, postgresDialect)
		expect(filtered({ dimension: 'page', operator: 'contains', value: 'blog' })).toMatch(
			/IN \(SELECT "hostname", "v" FROM .* AND \("path"\) COLLATE "default" ILIKE \$\d+ ESCAPE '\\'\)/s
		)
		expect(filtered({ dimension: 'event', operator: 'eq', value: 'signup' })).toContain(
			`AND CASE WHEN "type" = 'event' THEN "name" END = $`
		)
		expect(filtered({ dimension: 'currency', operator: 'eq', value: 'USD' })).toMatch(
			/AND \(COALESCE\("original_currency", "currency"\) = \$\d+ OR substr\("id", 1, 3\) = 'ow\.'\)/
		)
		expect(filtered({ dimension: 'referrer', operator: 'matches', value: '^g' })).toContain(
			'AND ("ref") COLLATE "default" ~* $'
		)
		expect(filtered({ dimension: 'goal', operator: 'eq', value: 'purchase' })).toContain(
			`AND ("goals" IS NOT NULL OR substr("id", 1, 3) = 'ow.'))`
		)
		expect(filtered({ dimension: 'item', operator: 'eq', value: 'offers:1' })).not.toContain(
			' IN (SELECT'
		)
	})
})
