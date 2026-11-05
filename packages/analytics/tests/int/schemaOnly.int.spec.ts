import { type BootedPayload, bootPayload, describeForDb } from '@10x-media/payload-test-harness'
import { buildConfig, type Payload, type SanitizedConfig } from 'payload'
import { afterAll, beforeAll, expect, it } from 'vitest'
import { isRecord } from '../../src/core/values'
import { GOALS_SLUG } from '../../src/goals/collection'
import { type AnalyticsPluginOptions, analytics } from '../../src/index'
import { stateStoreOf } from '../../src/maintenance/lease'
import { HITS_SLUG, STATE_SLUG } from '../../src/native/collections/slugs'
import { trackServerEvent } from '../../src/native/ingest/serverTrack'
import { native } from '../../src/native/nativeAdapter'
import { getRuntime, settleRetiredRuntimes } from '../../src/plugin/runtime'
import { PROVIDERS_SLUG } from '../../src/providers/collection'
import { CACHE_SLUG } from '../../src/surfacing/cacheCollection'
import { upsertSyncRow } from '../../src/sync/syncTask'
import { memoryAdapter } from '../../src/testing/memoryAdapter'
import { readForWidget } from '../../src/widgets/readForWidget'
import { readerRequest } from './readerRequest'

const SYNC_SLUG = 'analytics-daily'

/** Every collection the plugin registers on this install, each holding rows before the switch. */
const PLUGIN_SLUGS = [PROVIDERS_SLUG, GOALS_SLUG, SYNC_SLUG, CACHE_SLUG, HITS_SLUG, STATE_SLUG]

const optionsFor = (disabled: boolean): AnalyticsPluginOptions => ({
	disabled,
	adapters: [native(), memoryAdapter()],
	capture: { gate: 'off' },
	providers: { collection: true },
	goals: { collection: true },
	revenue: true,
	sync: true,
	cache: { warm: true },
	jobs: { queue: 'analytics' },
})

/** What a field puts in the database: its name, type, constraints, options and children. */
const fieldShape = (field: unknown): unknown => {
	if (!isRecord(field)) {
		return field
	}
	const shape: Record<string, unknown> = {}
	for (const key of [
		'name',
		'type',
		'required',
		'unique',
		'index',
		'localized',
		'hasMany',
		'relationTo',
		'dbName',
		'enumName',
	]) {
		if (field[key] !== undefined) {
			shape[key] = field[key]
		}
	}
	if (Array.isArray(field.options)) {
		shape.options = field.options.map((option) => (isRecord(option) ? option.value : option))
	}
	const children = Array.isArray(field.flattenedFields) ? field.flattenedFields : field.fields
	if (Array.isArray(children)) {
		shape.fields = children.map(fieldShape)
	}
	if (Array.isArray(field.blocks)) {
		shape.blocks = field.blocks.map((block) =>
			isRecord(block)
				? {
						slug: block.slug,
						fields: (Array.isArray(block.flattenedFields) ? block.flattenedFields : []).map(
							fieldShape
						),
					}
				: block
		)
	}
	return shape
}

const bySlug = (a: { slug: string }, b: { slug: string }): number => a.slug.localeCompare(b.slug)

/** The database schema a sanitized config describes, the jobs task enum included. */
const schemaOf = (config: SanitizedConfig) => ({
	collections: config.collections
		.map((collection) => ({
			slug: collection.slug,
			timestamps: collection.timestamps,
			versions: Boolean(collection.versions),
			fields: collection.flattenedFields.map(fieldShape),
			indexes: collection.indexes ?? [],
		}))
		.sort(bySlug),
	globals: config.globals
		.map((global) => ({ slug: global.slug, fields: global.flattenedFields.map(fieldShape) }))
		.sort(bySlug),
	tasks: (config.jobs.tasks ?? []).map((task) => task.slug).sort(),
})

/** The tables drizzle pushed, as plain data; MongoDB has none and answers null. */
const tablesOf = (payload: Payload): unknown => {
	const tables: unknown = Reflect.get(payload.db, 'rawTables')
	return isRecord(tables) ? JSON.parse(JSON.stringify(tables)) : null
}

const countsOf = async (payload: Payload): Promise<Record<string, number>> => {
	const counts: Record<string, number> = {}
	for (const slug of PLUGIN_SLUGS) {
		counts[slug] = (await payload.count({ collection: slug as never })).totalDocs
	}
	return counts
}

describeForDb('analytics disabled: true keeps the schema', {}, (db) => {
	let running: BootedPayload
	let switchedOff: BootedPayload | undefined
	let schemasMatch = false

	beforeAll(async () => {
		running = await bootPayload({ db, plugin: analytics(optionsFor(false)) })
	}, 240_000)

	afterAll(async () => {
		await switchedOff?.stop()
		await settleRetiredRuntimes(running.payload)
		await running.stop()
	})

	it(`sanitizes to the same collections, fields, indexes and task slugs on ${db}`, async () => {
		const configFor = (disabled: boolean) =>
			buildConfig({
				secret: 'test-secret-not-for-prod',
				db: running.payload.config.db,
				collections: [],
				typescript: { autoGenerate: false, outputFile: '/dev/null' },
				admin: { importMap: { autoGenerate: false } },
				telemetry: false,
				plugins: [analytics(optionsFor(disabled))],
			})
		const enabled = schemaOf(await configFor(false))
		const disabled = schemaOf(await configFor(true))
		expect(enabled.collections.map((collection) => collection.slug)).toEqual(
			expect.arrayContaining([...PLUGIN_SLUGS, 'payload-jobs'])
		)
		expect(enabled.tasks).toEqual(['analytics-maintain', 'analytics-sync', 'analytics-warm'])
		expect(disabled).toEqual(enabled)
		schemasMatch = true
	})

	it(`keeps every row when a switched-off instance pushes its schema on ${db}`, async () => {
		// A schema that differed would make the push below ask to drop data, which ends the process.
		if (!schemasMatch) {
			throw new Error('the schemas differ, so the switched-off instance is not booted')
		}
		const { payload } = running
		await payload.create({
			collection: PROVIDERS_SLUG as never,
			data: { name: 'site', provider: 'native', enabled: true } as never,
		})
		await payload.create({
			collection: GOALS_SLUG as never,
			data: { name: 'Signup', slug: 'signup', match: { kind: 'goal' } } as never,
		})
		await upsertSyncRow(payload, SYNC_SLUG, {
			source: 'memory',
			date: new Date(Date.UTC(2026, 9, 1)),
			syncedAt: new Date(),
			scope: '',
			pageviews: 4,
		})
		await trackServerEvent(payload, { type: 'pageview', path: '/kept', hostname: 'kept.example' })
		await stateStoreOf(payload)?.beat('analytics-sync')
		const read = await readForWidget({
			req: readerRequest(payload),
			metrics: ['pageviews'],
			timeframe: 'last7days',
			adapterId: 'memory',
			now: new Date(),
		})
		expect(read.status).toBe('ok')
		// The read's answer is written to analytics-cache in the background.
		await getRuntime(payload)?.engine.idle?.()
		const before = await countsOf(payload)
		for (const slug of PLUGIN_SLUGS) {
			expect(before[slug], slug).toBeGreaterThan(0)
		}

		switchedOff = await bootPayload({ db, attachTo: running, plugin: analytics(optionsFor(true)) })
		// The running instance may still be writing state in the background; nothing may be gone.
		const after = await countsOf(switchedOff.payload)
		for (const slug of PLUGIN_SLUGS) {
			expect(after[slug], slug).toBeGreaterThanOrEqual(before[slug] ?? 0)
		}
		expect(tablesOf(switchedOff.payload)).toEqual(tablesOf(payload))
		expect(Reflect.get(switchedOff.payload, Symbol.for('@10x-media/analytics/runtime'))).toBe(
			undefined
		)
	})
})
