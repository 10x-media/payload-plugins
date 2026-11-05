import { type BootedPayload, bootPayload, describeForDb } from '@10x-media/payload-test-harness'
import { afterAll, beforeAll, expect, it } from 'vitest'
import { UnsupportedFilterError } from '../../src/core/sourceErrors'
import { analytics } from '../../src/index'
import { native } from '../../src/native/nativeAdapter'
import { hitsModelOf } from '../../src/native/store/eventStore'
import { memoryStateStore } from '../../src/native/store/memory/memoryState'
import { memoryEventStore } from '../../src/native/store/memory/memoryStore'
import { patternFault } from '../../src/native/store/pattern'
import { createSqlExecutor } from '../../src/native/store/sql/executor'
import { raw } from '../../src/native/store/sql/fragment'
import type { HitRow, RawRead } from '../../src/native/store/types'
import { classifyError } from '../../src/surfacing/classifyError'
import { nativeOf, pageviewHit } from './nativeHelpers'

const START = new Date('2026-06-10T00:00:00.000Z')
const END = new Date('2026-06-11T00:00:00.000Z')

const PATHS = [
	'/',
	'/blog/intro',
	'/BLOG/Outro',
	'/docs/a',
	'/guides/b',
	'/p/7',
	'/p/123',
	'/p/1234',
	'/report.pdf',
	'/page.html',
	'/page.htm',
	'/über-uns',
	'/pricing',
	'/plans',
	'/a-b c',
	'/x]y',
	'/xx',
	'/abab',
]

/** Patterns of the subset, each run by the database and compared with JavaScript's answer. */
const PATTERNS = [
	'',
	'^/blog/',
	'\\.pdf$',
	'^/(docs|guides)/',
	'^/p/[0-9]+$',
	'^/p/\\d{2,3}$',
	'[a-z]{3}',
	'[^/]+\\.html?$',
	'(?:pricing|plans)',
	'^/über',
	'a.b',
	'[\\]x]',
	'\\w-\\w\\s',
	'x{2}',
	'(ab)+',
]

const HITS: HitRow[] = PATHS.map((path, index) =>
	pageviewHit({ ts: new Date(START.getTime() + (index + 1) * 60_000), v: `v${index}`, path })
)

const matching = (value: string): RawRead => ({
	start: START,
	end: END,
	filters: [{ dimension: 'page', operator: 'matches', value }],
	sessions: false,
	timeoutMs: 5_000,
})

describeForDb('native matches patterns', {}, (db) => {
	let booted: BootedPayload

	beforeAll(async () => {
		booted = await bootPayload({
			plugin: analytics({ adapters: [native()], capture: { gate: 'off' } }),
			db,
		})
		await nativeOf(booted.payload).store.append(HITS)
	}, 120_000)

	afterAll(async () => {
		await booted?.stop()
	})

	it(`counts what JavaScript counts for every pattern of the subset on ${db}`, async () => {
		const { store } = nativeOf(booted.payload)
		const memory = memoryEventStore({ state: memoryStateStore() })
		await memory.append(HITS)
		for (const pattern of PATTERNS) {
			const expected = await memory.readRaw(matching(pattern))
			if (db === 'sqlite') {
				await expect(store.readRaw(matching(pattern))).rejects.toBeInstanceOf(
					UnsupportedFilterError
				)
				continue
			}
			expect({ pattern, rows: await store.readRaw(matching(pattern)) }).toEqual({
				pattern,
				rows: expected,
			})
		}
	})

	it(`refuses a pattern outside the subset as invalid_param before the database sees it on ${db}`, async () => {
		const { engine } = nativeOf(booted.payload)
		for (const pattern of ['[^]1', '(a+)+', '(?=x)']) {
			const failed = await engine
				.read({
					metrics: ['pageviews'],
					filters: [{ dimension: 'page', operator: 'matches', value: pattern }],
					dateRange: { start: START, end: END },
				})
				.then(
					() => null,
					(err: unknown) => err
				)
			expect(classifyError(failed)).toMatchObject({ kind: 'invalid_param', param: 'filters' })
		}
	})

	it(`answers the database's own refusal of a pattern as invalid_param on ${db}`, async () => {
		if (db === 'postgres') {
			const executor = createSqlExecutor(booted.payload)
			const refused = await executor.select(raw(`SELECT 'a' ~* '(' AS "m"`)).then(
				() => null,
				(err: unknown) => err
			)
			expect(classifyError(patternFault(refused))).toMatchObject({
				kind: 'invalid_param',
				param: 'filters',
			})
			return
		}
		if (db === 'mongo') {
			const answered = async (): Promise<unknown> => {
				const cursor: unknown = await hitsModelOf(booted.payload).collection.aggregate(
					[{ $match: { path: { $regex: '(' } } }],
					{}
				)
				const toArray: unknown = cursor ? Reflect.get(Object(cursor), 'toArray') : undefined
				return typeof toArray === 'function' ? Reflect.apply(toArray, cursor, []) : cursor
			}
			const refused = await answered().then(
				() => null,
				(err: unknown) => err
			)
			expect(classifyError(patternFault(refused))).toMatchObject({
				kind: 'invalid_param',
				param: 'filters',
			})
		}
	})
})
