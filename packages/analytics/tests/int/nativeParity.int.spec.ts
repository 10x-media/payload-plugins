import { type BootedPayload, bootPayload, describeForDb } from '@10x-media/payload-test-harness'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { analytics } from '../../src/index'
import { native } from '../../src/native/nativeAdapter'
import { dayWindow } from '../../src/native/store/aggregate'
import { DEFAULT_CAPS } from '../../src/native/store/caps'
import { createEventStore, type EventStoreOptions } from '../../src/native/store/eventStore'
import { memoryStateStore } from '../../src/native/store/memory/memoryState'
import { memoryEventStore } from '../../src/native/store/memory/memoryStore'
import { DAY_LEASE_MS, dayKey } from '../../src/native/store/state'
import { createStateStore } from '../../src/native/store/stateStore'
import type {
	AggregateRead,
	AggregateRow,
	EventStore,
	RawRead,
	RawRow,
	StateStore,
} from '../../src/native/store/types'
import { calendarDayOf } from '../../src/timeframe/calendar'
import { randomFixture } from './hitFixtures'

const plugin = () => analytics({ adapters: [native()], capture: { gate: 'off' } })

const TIMEOUT = 20_000

const PARITY = [
	{ seed: 20261007, scope: 'parity', other: 'parity-other' },
	{ seed: 5, scope: 'parity-b', other: 'parity-b-other' },
].map((fixture) => ({ ...fixture, ...randomFixture(fixture.seed, fixture.scope, fixture.other) }))

const [FIRST] = PARITY
if (!FIRST) {
	throw new Error('no parity fixture')
}
/** The fixture's UTC midnights; every fixture covers the same four days. */
const STARTS = FIRST.days
const DAYS = STARTS.slice(0, 4).map((start) => calendarDayOf(start, 'UTC'))

const dayAt = (index: number): number => {
	const day = DAYS[index]
	if (day === undefined) {
		throw new Error(`the fixture has no day ${index}`)
	}
	return day
}

const startAt = (index: number): Date => {
	const start = STARTS[index]
	if (!start) {
		throw new Error(`the fixture has no day ${index}`)
	}
	return start
}

/** An aggregate row as a raw read answers it: a day series row carries its bucket, not its day. */
const asRaw = (rows: readonly AggregateRow[]): RawRow[] =>
	rows.map(({ day, ...row }) => (day === undefined ? row : { ...row, bucket: DAYS.indexOf(day) }))

const DIMENSIONS = [
	'page',
	'event',
	'goal',
	'currency',
	'item',
	'referrer',
	'source',
	'channel',
	'utmSource',
	'utmMedium',
	'utmCampaign',
	'utmContent',
	'utmTerm',
	'country',
	'region',
	'city',
	'language',
	'device',
	'browser',
	'os',
] as const

/** Reads of closed days, each beside the raw read over the same instants that must answer alike. */
const battery = (scope: string | undefined): Array<[string, AggregateRead, RawRead]> => {
	const all = { scope, days: [[dayAt(0), dayAt(3)] as const] }
	const raw: RawRead = {
		scope,
		start: startAt(0),
		end: startAt(4),
		filters: [],
		sessions: true,
		timeoutMs: TIMEOUT,
	}
	const buckets = STARTS.slice(0, 4)
	return [
		['total', { ...all, dim: '', groupBy: 'total' }, raw],
		[
			'total on one hostname',
			{ ...all, dim: '', groupBy: 'total', hostname: 'b.example' },
			{ ...raw, hostname: 'b.example' },
		],
		[
			'one day, visitors exact',
			{ scope, days: [[dayAt(1), dayAt(1)]], dim: '', groupBy: 'total' },
			{ ...raw, start: startAt(1), end: startAt(2) },
		],
		['day series', { ...all, dim: '', groupBy: 'day' }, { ...raw, buckets }],
		[
			'day series of one source',
			{ ...all, dim: 'source', value: 'google', groupBy: 'day' },
			{ ...raw, buckets, filters: [{ dimension: 'source', operator: 'eq', value: 'google' }] },
		],
		...DIMENSIONS.map((dimension): [string, AggregateRead, RawRead] => [
			`by ${dimension}`,
			{ ...all, dim: dimension, groupBy: 'value' },
			{ ...raw, groupBy: dimension },
		]),
		...(['channel', 'source', 'utmCampaign'] as const).map(
			(dimension): [string, AggregateRead, RawRead] => [
				`goal purchase by ${dimension}`,
				{ ...all, dim: 'goal', value: 'purchase', dim2: dimension, groupBy: 'value2' },
				{
					...raw,
					groupBy: dimension,
					filters: [{ dimension: 'goal', operator: 'eq', value: 'purchase' }],
				},
			]
		),
		...['offers:1', 'offers:2', 'offers:3', 'offers:9'].map(
			(ref): [string, AggregateRead, RawRead] => [
				`item ${ref} by page`,
				{ ...all, dim: 'item', value: ref, dim2: 'page', groupBy: 'value2' },
				{ ...raw, sessions: false, item: ref, groupBy: 'page' },
			]
		),
		[
			'pages by visitors, top 3',
			{ ...all, dim: 'page', groupBy: 'value', order: { part: 'visitors', dir: 'desc' }, limit: 3 },
			{ ...raw, groupBy: 'page', order: { part: 'visitors', dir: 'desc' }, limit: 3 },
		],
		[
			'pages by time per pageview, top 4',
			{
				...all,
				dim: 'page',
				groupBy: 'value',
				order: { part: 'durationMs', per: 'pageviews', dir: 'desc' },
				limit: 4,
			},
			{
				...raw,
				groupBy: 'page',
				order: { part: 'durationMs', per: 'pageviews', dir: 'desc' },
				limit: 4,
			},
		],
		[
			'sources by bounce rate, lowest first',
			{
				...all,
				dim: 'source',
				groupBy: 'value',
				order: { part: 'bounces', per: 'entries', dir: 'asc' },
			},
			{ ...raw, groupBy: 'source', order: { part: 'bounces', per: 'entries', dir: 'asc' } },
		],
		[
			'pages filled in exactly',
			{ ...all, dim: 'page', groupBy: 'value', values: ['/pricing', '/über', '/missing'] },
			{ ...raw, groupBy: 'page', values: ['/pricing', '/über', '/missing'] },
		],
	]
}

/**
 * MongoDB folds a day's rows in sets of ids, and per visitor once a set outgrows its memory, so
 * its days are read once folded each way; Postgres and SQLite fold one way.
 */
const passesOf = (db: string): Array<{ name: string; options: EventStoreOptions }> => [
	{ name: 'folded the default way', options: {} },
	...(db === 'mongo' ? [{ name: 'folded per visitor', options: { perVisitor: true } }] : []),
]

describeForDb('engine day aggregation parity', {}, (db) => {
	let booted: BootedPayload
	let store: EventStore
	let state: StateStore
	const memoryState = memoryStateStore()
	const memory = memoryEventStore({ state: memoryState })

	/** Every scope of every fixture, aggregated day by day as the maintenance run will. */
	const aggregateEveryDay = async (
		on: EventStore,
		coordination: StateStore,
		pass: string
	): Promise<void> => {
		for (const fixture of PARITY) {
			for (const scope of [fixture.scope, fixture.other]) {
				for (const day of DAYS) {
					await coordination.ensureMarkers([{ scope, day, tz: 'UTC' }])
					const runId = `${pass}:${scope}:${day}`
					expect(await coordination.claim(dayKey(scope, day), runId, DAY_LEASE_MS)).toBe(true)
					const result = await on.aggregateDay(dayWindow(scope, day, 'UTC'), {
						runId,
						caps: DEFAULT_CAPS,
						status: 'final',
					})
					expect(result).toMatchObject({ completed: true })
				}
			}
		}
	}

	beforeAll(async () => {
		booted = await bootPayload({ db, plugin: plugin() })
		store = createEventStore(booted.payload)
		state = createStateStore(booted.payload)
		const hits = PARITY.flatMap((fixture) => fixture.hits)
		expect(await store.append(hits)).toEqual({ written: hits.length, duplicates: 0 })
		await memory.append(hits)
		await aggregateEveryDay(memory, memoryState, 'memory')
	}, 240_000)

	afterAll(async () => {
		await booted?.stop()
	})

	for (const pass of passesOf(db)) {
		describe(pass.name, () => {
			beforeAll(async () => {
				await aggregateEveryDay(createEventStore(booted.payload, pass.options), state, pass.name)
			}, 240_000)

			describe.each([
				...PARITY.map((fixture) => ({
					name: `random fixture ${fixture.seed}`,
					scope: fixture.scope,
				})),
				{ name: 'every scope', scope: undefined },
			])('aggregates equal raw reads and the memory store: $name', ({ scope }) => {
				for (const [name, read, raw] of battery(scope)) {
					it(name, async () => {
						const answer = await store.readAggregates(read)
						expect(answer).toEqual(await memory.readAggregates(read))
						expect(asRaw(answer)).toEqual(await store.readRaw(raw))
						expect(answer.length).toBeGreaterThan(0)
					})
				}
			})
		})
	}
})
