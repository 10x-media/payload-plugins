import { type BootedPayload, bootPayload, describeForDb } from '@10x-media/payload-test-harness'
import { GRAPHQL_POST } from '@payloadcms/next/routes'
import { getNavGroups, getVisibleEntities } from '@payloadcms/ui/shared'
import {
	type CollectionConfig,
	createLocalReq,
	Forbidden,
	getAccessResults,
	handleEndpoints,
	type Payload,
} from 'payload'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { isRecord } from '../../src/core/values'
import { analytics } from '../../src/index'
import {
	AGGREGATES_SLUG,
	HITS_SLUG,
	STATE_SLUG,
	STORE_SLUGS,
} from '../../src/native/collections/slugs'
import { native } from '../../src/native/nativeAdapter'
import { createSqlExecutor, type SqlExecutor } from '../../src/native/store/sql/executor'
import { sql } from '../../src/native/store/sql/fragment'
import { createStateStore } from '../../src/native/store/stateStore'

const USERS = 'store-users'
const PROBES = 'store-probes'

const users: CollectionConfig = { slug: USERS, auth: true, fields: [] }

/** A plain collection beside the engine's, so every "absent" below has a "present" to compare. */
const probes: CollectionConfig = {
	slug: PROBES,
	access: { read: () => true, create: () => true },
	fields: [{ name: 'title', type: 'text' }],
}

const TABLES: Record<string, string> = {
	[HITS_SLUG]: 'analytics_hits',
	[AGGREGATES_SLUG]: 'analytics_aggregates',
	[STATE_SLUG]: 'analytics_state',
}

const HIT_ROW = {
	id: 'hit-1',
	scope: '',
	ts: '2026-10-05T10:00:00.000Z',
	type: 'pageview',
	hostname: 'example.com',
	path: '/',
	v: 'VVVVVVVVVVVVVVVV',
	landing: true,
	server: false,
	props: { plan: 'pro' },
}

const AGGREGATE_ROW = {
	id: 'agg-1',
	scope: '',
	day: 20261005,
	hostname: 'example.com',
	dim: '',
	value: '',
	dim2: '',
	value2: '',
	gen: 'run-secret',
	pageviews: 3,
}

/** Payload keeps one instance per cache key; the GraphQL route asks for the `default` one. */
interface InstanceSlot {
	initializedCrons: boolean
	payload: Payload
	promise: null
	reload: boolean
	ws: null
}

/**
 * An anonymous POST to `/api/graphql` through Payload's own route handler. That handler resolves
 * its instance under the `default` cache key only, so this instance stands there for the call.
 */
const graphql = async (
	payload: Payload,
	query: string
): Promise<{ status: number; body: unknown }> => {
	const instances: unknown = Reflect.get(globalThis, '_payload')
	if (!(instances instanceof Map)) {
		throw new Error('Payload keeps no instance cache for its GraphQL route to read')
	}
	const previous: unknown = instances.get('default')
	const slot: InstanceSlot = {
		initializedCrons: true,
		payload,
		promise: null,
		reload: false,
		ws: null,
	}
	instances.set('default', slot)
	try {
		const response = await GRAPHQL_POST(payload.config)(
			new Request('http://localhost:3000/api/graphql', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ query }),
			})
		)
		return { status: response.status, body: await response.json() }
	} finally {
		if (previous === undefined) {
			instances.delete('default')
		} else {
			instances.set('default', previous)
		}
	}
}

const errorMessages = (body: unknown): string[] => {
	const errors = isRecord(body) ? body.errors : undefined
	return Array.isArray(errors)
		? errors.flatMap((error) =>
				isRecord(error) && typeof error.message === 'string' ? [error.message] : []
			)
		: []
}

const fieldNames = (body: unknown, type: 'queryType' | 'mutationType'): string[] => {
	const schema = isRecord(body) && isRecord(body.data) ? body.data.__schema : undefined
	const root = isRecord(schema) ? schema[type] : undefined
	const fields = isRecord(root) ? root.fields : undefined
	return Array.isArray(fields)
		? fields.flatMap((field) =>
				isRecord(field) && typeof field.name === 'string' ? [field.name] : []
			)
		: []
}

/** The column list an index definition names, `(scope, ts)` read as `['scope', 'ts']`. */
const indexColumns = (definition: string): string[] =>
	(/\(([^)]*)\)\s*$/.exec(definition)?.[1] ?? '')
		.split(',')
		.map((column) => column.trim().replaceAll('"', ''))

describeForDb('engine store collections', {}, (db) => {
	let booted: BootedPayload

	beforeAll(async () => {
		booted = await bootPayload({
			db,
			plugin: analytics({ adapters: [native()], capture: { gate: 'off' } }),
			collections: [users, probes],
		})
		await booted.payload.db.create({ collection: HITS_SLUG, data: HIT_ROW, req: {} })
		await booted.payload.db.create({ collection: AGGREGATES_SLUG, data: AGGREGATE_ROW, req: {} })
		await createStateStore(booted.payload).salt(20261005)
	}, 240_000)

	afterAll(async () => {
		await booted?.stop()
	})

	const rest = (method: string, path: string, body?: unknown) =>
		handleEndpoints({
			config: booted.payload.config,
			payloadInstanceCacheKey: booted.cacheKey,
			request: new Request(`http://localhost:3000/api${path}`, {
				method,
				...(body === undefined
					? {}
					: { body: JSON.stringify(body), headers: { 'content-type': 'application/json' } }),
			}),
		})

	describe('REST', () => {
		it.each(STORE_SLUGS)('answers no anonymous call on %s, and writes nothing', async (slug) => {
			const before = await booted.payload.db.count({ collection: slug, req: {} })
			const calls: Array<[string, string, unknown?]> = [
				['GET', `/${slug}`],
				['GET', `/${slug}/count`],
				['GET', `/${slug}/hit-1`],
				['POST', `/${slug}`, { id: 'planted', scope: '' }],
				['PATCH', `/${slug}/hit-1`, { scope: 'stolen' }],
				['PATCH', `/${slug}?where[scope][equals]=`, { scope: 'stolen' }],
				['DELETE', `/${slug}/hit-1`],
				['DELETE', `/${slug}?where[scope][equals]=`],
			]
			for (const [method, path, body] of calls) {
				const response = await rest(method, path, body)
				expect(response.status, `${method} ${path}`).toBe(501)
				expect(JSON.stringify(await response.json()), `${method} ${path}`).not.toMatch(
					/VVVVVVVVVVVVVVVV|run-secret|plan|salt:2026|docs/
				)
			}
			expect(await booted.payload.db.count({ collection: slug, req: {} })).toEqual(before)
		})

		it('still serves a collection that keeps its endpoints, so the refusals above are real', async () => {
			const response = await rest('GET', `/${PROBES}`)
			expect(response.status).toBe(200)
		})
	})

	describe('GraphQL', () => {
		it('lists no query or mutation for any of the three collections', async () => {
			const { status, body } = await graphql(
				booted.payload,
				'{ __schema { queryType { fields { name } } mutationType { fields { name } } } }'
			)
			expect(status).toBe(200)
			const names = [...fieldNames(body, 'queryType'), ...fieldNames(body, 'mutationType')]
			expect(names).toEqual(expect.arrayContaining(['StoreProbes', 'createStoreProbe']))
			expect(names.filter((name) => /Analytics(Hit|Aggregate|State)/.test(name))).toEqual([])
		})

		it('refuses an anonymous query and mutation as fields that do not exist', async () => {
			const read = await graphql(booted.payload, '{ AnalyticsHits { docs { id } } }')
			expect(errorMessages(read.body)).toEqual([
				expect.stringMatching(/^Cannot query field "AnalyticsHits" on type "Query"\./),
			])
			const write = await graphql(
				booted.payload,
				'mutation { createAnalyticsState(data: { kind: "salt" }) { id } }'
			)
			expect(errorMessages(write.body)).toEqual([
				expect.stringMatching(/^Cannot query field "createAnalyticsState" on type "Mutation"\./),
			])
			expect(JSON.stringify(read.body)).not.toContain('VVVVVVVVVVVVVVVV')
		})
	})

	describe('admin and Local API', () => {
		it('keeps the three collections out of the admin, even for a signed-in admin', async () => {
			const { payload } = booted
			const admin = await payload.create({
				collection: USERS,
				data: { email: `store-admin-${db}@example.test`, password: 'store-admin-pw' },
			})
			const req = await createLocalReq({ user: { ...admin, collection: USERS } }, payload)
			const visible = getVisibleEntities({ req })
			expect(visible.collections).toContain(PROBES)
			for (const slug of STORE_SLUGS) {
				expect(visible.collections).not.toContain(slug)
			}
			const permissions = await getAccessResults({ req })
			const nav = getNavGroups(permissions, visible, payload.config, req.i18n)
			const listed = nav.flatMap((group) => group.entities.map((entity) => entity.slug))
			expect(listed).toContain(PROBES)
			for (const slug of STORE_SLUGS) {
				expect(listed).not.toContain(slug)
				const granted = permissions.collections?.[slug]
				for (const operation of ['read', 'create', 'update', 'delete'] as const) {
					expect(granted?.[operation], `${slug} ${operation}`).toBeFalsy()
				}
			}
			for (const slug of STORE_SLUGS) {
				await expect(
					payload.find({ collection: slug, overrideAccess: false, user: req.user })
				).rejects.toBeInstanceOf(Forbidden)
			}
		})
	})

	describe('schema', () => {
		it('leaves the three collections out of document locking', async () => {
			const locked = booted.payload.collections['payload-locked-documents']?.config.fields.find(
				(field) => 'name' in field && field.name === 'document'
			)
			const relationTo = locked && 'relationTo' in locked ? locked.relationTo : []
			expect(relationTo).toContain(PROBES)
			for (const slug of STORE_SLUGS) {
				expect(relationTo).not.toContain(slug)
			}
		})

		it('reads back through Payload’s own adapter what the engine wrote, and the reverse', async () => {
			const { payload } = booted
			const hit: unknown = await payload.db.findOne({
				collection: HITS_SLUG,
				where: { id: { equals: 'hit-1' } },
				req: {},
			})
			expect(hit).toMatchObject({ id: 'hit-1', ts: '2026-10-05T10:00:00.000Z', landing: true })
			expect(isRecord(hit) ? hit.props : undefined).toEqual({ plan: 'pro' })
			const salt: unknown = await payload.db.findOne({
				collection: STATE_SLUG,
				where: { id: { equals: 'salt:2026-10-05' } },
				req: {},
			})
			expect(salt).toMatchObject({
				id: 'salt:2026-10-05',
				kind: 'salt',
				scope: '',
				day: 20261005,
				expiresAt: '2026-10-08T00:00:00.000Z',
			})
			expect(typeof (isRecord(salt) ? salt.value : undefined)).toBe('string')
		})

		if (db === 'mongo') {
			it('keys every collection by a string _id and types each field as Payload maps it', async () => {
				const models: unknown = Reflect.get(booted.payload.db, 'collections')
				const modelOf = (slug: string) => {
					const model = isRecord(models) ? models[slug] : undefined
					if (typeof model !== 'function') {
						throw new Error(`no model for ${slug}`)
					}
					return model as unknown as {
						schema: { path: (name: string) => { instance: string } | undefined }
						listIndexes: () => Promise<Array<{ key: Record<string, number> }>>
						collection: { findOne: (filter: object) => Promise<Record<string, unknown> | null> }
					}
				}
				const hits = modelOf(HITS_SLUG)
				expect(hits.schema.path('_id')?.instance).toBe('String')
				expect(hits.schema.path('ts')?.instance).toBe('Date')
				expect(hits.schema.path('landing')?.instance).toBe('Boolean')
				expect(hits.schema.path('durationMs')?.instance).toBe('Number')
				expect(hits.schema.path('props')?.instance).toBe('Mixed')
				expect(hits.schema.path('createdAt')).toBeUndefined()
				const stored = await hits.collection.findOne({ _id: 'hit-1' })
				expect(stored?._id).toBe('hit-1')
				expect(stored?.ts).toBeInstanceOf(Date)
				const indexes = async (slug: string) =>
					(await modelOf(slug).listIndexes()).map((index) => Object.keys(index.key)).sort()
				expect(await indexes(HITS_SLUG)).toEqual([['_id'], ['scope', 'ts']])
				expect(await indexes(AGGREGATES_SLUG)).toEqual([
					['_id'],
					['scope', 'dim', 'dim2', 'day'],
					['scope', 'dim', 'value', 'day'],
				])
				expect(await indexes(STATE_SLUG)).toEqual([
					['_id'],
					['kind', 'scope', 'day'],
					['kind', 'status', 'day'],
				])
			})
			return
		}

		let executor: SqlExecutor
		beforeAll(() => {
			executor = createSqlExecutor(booted.payload)
		})

		/** Every column of a table: its type, whether it is NOT NULL, its default, and the key. */
		const columnsOf = async (
			table: string
		): Promise<Record<string, { type: string; notNull: boolean; dflt: unknown; pk: boolean }>> => {
			if (db === 'postgres') {
				const rows = await executor.select(
					sql`SELECT c.column_name AS name, c.data_type AS type, c.is_nullable AS nullable, c.column_default AS dflt,
						EXISTS (SELECT 1 FROM pg_index i JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = ANY(i.indkey)
							WHERE i.indrelid = to_regclass(${table}::text) AND i.indisprimary AND a.attname = c.column_name) AS pk
						FROM information_schema.columns c WHERE c.table_schema = current_schema() AND c.table_name = ${table}`
				)
				return Object.fromEntries(
					rows.map((row) => [
						String(row.name),
						{
							type: String(row.type),
							notNull: row.nullable === 'NO',
							dflt: row.dflt,
							pk: row.pk === true,
						},
					])
				)
			}
			const rows = await executor.select(
				sql`SELECT name, type, "notnull" AS not_null, dflt_value AS dflt, pk FROM pragma_table_info(${table})`
			)
			return Object.fromEntries(
				rows.map((row) => [
					String(row.name),
					{
						type: String(row.type).toLowerCase(),
						notNull: Number(row.not_null) === 1,
						dflt: row.dflt,
						pk: Number(row.pk) > 0,
					},
				])
			)
		}

		/** Every index of a table as its column list, the primary key's included. */
		const indexesOf = async (table: string): Promise<string[][]> => {
			if (db === 'postgres') {
				const rows = await executor.select(
					sql`SELECT indexdef FROM pg_indexes WHERE schemaname = current_schema() AND tablename = ${table} ORDER BY indexname`
				)
				return rows.map((row) => indexColumns(String(row.indexdef))).sort()
			}
			const indexes = await executor.select(sql`SELECT name FROM pragma_index_list(${table})`)
			const columns = await Promise.all(
				indexes.map(async (index) =>
					(
						await executor.select(
							sql`SELECT name FROM pragma_index_info(${String(index.name)}) ORDER BY seqno`
						)
					).map((column) => String(column.name))
				)
			)
			return columns.sort()
		}

		const text = db === 'postgres' ? 'character varying' : 'text'
		const date = db === 'postgres' ? 'timestamp with time zone' : 'text'
		const json = db === 'postgres' ? 'jsonb' : 'text'
		const number = 'numeric'
		const flag = db === 'postgres' ? 'boolean' : 'integer'

		it('keys every table by a text primary key, never a sequence, with no timestamps', async () => {
			for (const slug of STORE_SLUGS) {
				const columns = await columnsOf(TABLES[slug] ?? slug)
				expect(columns.id, slug).toMatchObject({ type: text, pk: true, notNull: true })
				expect(String(columns.id?.dflt ?? ''), slug).not.toMatch(/nextval|autoincrement/i)
				expect(columns.created_at, slug).toBeUndefined()
				expect(columns.updated_at, slug).toBeUndefined()
			}
		})

		it('types the hit columns as Payload maps their fields: dates and JSON as text on SQLite', async () => {
			const columns = await columnsOf('analytics_hits')
			expect(Object.keys(columns).sort()).toEqual(
				[
					'id',
					'scope',
					'ts',
					'last_at',
					'type',
					'hostname',
					'path',
					'v',
					'landing',
					'server',
					'mode',
					'name',
					'ref',
					'source',
					'channel',
					'click_id',
					'utm_source',
					'utm_medium',
					'utm_campaign',
					'utm_content',
					'utm_term',
					'channel_version',
					'country',
					'region',
					'city',
					'language',
					'device',
					'browser',
					'os',
					'duration_ms',
					'scroll_depth',
					'value',
					'original_value',
					'conversions',
					'revenue',
					'currency',
					'original_currency',
					'item',
					'props',
					'goals',
					'impressions',
				].sort()
			)
			expect(columns.scope).toMatchObject({ type: text, notNull: true })
			expect(String(columns.scope?.dflt)).toContain("''")
			expect(columns.ts).toMatchObject({ type: date, notNull: true })
			expect(columns.last_at).toMatchObject({ type: date, notNull: false })
			expect(columns.landing).toMatchObject({ type: flag, notNull: true })
			expect(columns.duration_ms).toMatchObject({ type: number, notNull: false })
			expect(columns.props).toMatchObject({ type: json, notNull: false })
			expect(columns.mode).toMatchObject({ type: text, notNull: false })
			expect(await indexesOf('analytics_hits')).toEqual([['id'], ['scope', 'ts']])
		})

		it('gives aggregates and state their columns and indexes', async () => {
			const aggregates = await columnsOf('analytics_aggregates')
			for (const key of ['scope', 'hostname', 'dim', 'value', 'dim2', 'value2']) {
				expect(aggregates[key], key).toMatchObject({ type: text, notNull: true })
			}
			expect(aggregates.day).toMatchObject({ type: number, notNull: true })
			for (const part of [
				'pageviews',
				'session_ms',
				'scroll_sum',
				'interactions',
				'pageviews_without_visitor',
				'pageviews_without_consent',
			]) {
				expect(aggregates[part], part).toMatchObject({ type: number, notNull: false })
			}
			expect(await indexesOf('analytics_aggregates')).toEqual([
				['id'],
				['scope', 'dim', 'dim2', 'day'],
				['scope', 'dim', 'value', 'day'],
			])
			const state = await columnsOf('analytics_state')
			expect(Object.keys(state).sort()).toEqual(
				[
					'id',
					'kind',
					'scope',
					'day',
					'tz',
					'status',
					'version',
					'gen',
					'hits',
					'lease_owner',
					'lease_until',
					'final_after',
					'aggregated_at',
					'value',
					'expires_at',
				].sort()
			)
			expect(state.lease_until).toMatchObject({ type: date })
			expect(state.value).toMatchObject({ type: json })
			expect(await indexesOf('analytics_state')).toEqual([
				['id'],
				['kind', 'scope', 'day'],
				['kind', 'status', 'day'],
			])
		})

		it('stores instants as Payload does: ISO text on SQLite, comparable as text', async () => {
			const [hit] = await executor.select(sql`SELECT ts FROM analytics_hits WHERE id = ${'hit-1'}`)
			const [salt] = await executor.select(
				sql`SELECT expires_at FROM analytics_state WHERE id = ${'salt:2026-10-05'}`
			)
			if (db === 'sqlite') {
				expect(hit?.ts).toBe('2026-10-05T10:00:00.000Z')
				expect(salt?.expires_at).toBe('2026-10-08T00:00:00.000Z')
			} else {
				expect(hit?.ts).toEqual(new Date('2026-10-05T10:00:00.000Z'))
				expect(salt?.expires_at).toEqual(new Date('2026-10-08T00:00:00.000Z'))
			}
		})

		it('adds no column to payload_locked_documents_rels for the three collections', async () => {
			const columns = Object.keys(await columnsOf('payload_locked_documents_rels'))
			expect(columns).toContain('store_probes_id')
			for (const table of Object.values(TABLES)) {
				expect(columns).not.toContain(`${table}_id`)
			}
		})
	})
})
