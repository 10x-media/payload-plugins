import { type BootedPayload, bootPayload, describeForDb } from '@10x-media/payload-test-harness'
import { afterAll, beforeAll, beforeEach, expect, it, vi } from 'vitest'
import { analytics } from '../../src/index'
import { HITS_SLUG } from '../../src/native/collections/slugs'
import { toHit } from '../../src/native/engine/toHit'
import { noopResolver } from '../../src/native/geo/geoResolver'
import { SERVER_USER_AGENT } from '../../src/native/ingest/device'
import {
	eventTime,
	normalizeEvent,
	type RawEventInput,
} from '../../src/native/ingest/normalizeEvent'
import { native } from '../../src/native/nativeAdapter'
import { createEventStore } from '../../src/native/store/eventStore'
import { ulid } from '../../src/native/store/ids'
import { createSqlExecutor } from '../../src/native/store/sql/executor'
import { compile, type SqlFragment, sql } from '../../src/native/store/sql/fragment'
import type { EventStore, HitRow } from '../../src/native/store/types'

const plugin = () => analytics({ adapters: [native()], capture: { gate: 'off' } })

const AT = new Date('2026-10-06T10:00:00.123Z')

const hit = (overrides: Partial<HitRow> = {}): HitRow => ({
	id: ulid(AT),
	scope: '',
	ts: AT,
	type: 'pageview',
	hostname: 'a.example',
	path: '/',
	v: 'AAAAAAAAAAAAAAAA',
	landing: true,
	server: false,
	...overrides,
})

const many = (count: number, prefix: string): HitRow[] =>
	Array.from({ length: count }, (_, i) =>
		hit({ id: `${prefix}${String(i).padStart(5, '0')}`, path: `/${prefix}/${i}` })
	)

/** A hit as Payload reads it back: a date as ISO text, an absent field as nothing at all. */
const asRead = (row: HitRow): Record<string, unknown> =>
	Object.fromEntries(
		Object.entries(row)
			.filter(([, value]) => value !== undefined)
			.map(([key, value]) => [key, value instanceof Date ? value.toISOString() : value])
	)

/** A document Payload's adapter answered, without the columns it holds no value in. */
const present = (doc: Record<string, unknown>): Record<string, unknown> =>
	Object.fromEntries(
		Object.entries(doc).filter(([, value]) => value !== null && value !== undefined)
	)

/** The landing pageview, engagement, sale and anonymous server event of one visit. */
const VISIT: HitRow[] = [
	hit({
		id: ulid(AT),
		scope: 'tenant-a',
		ref: 'google.com',
		source: 'google.com',
		channel: 'organic-search',
		channelVersion: 1,
		clickId: 'gclid',
		utmSource: 'spring',
		utmMedium: 'cpc',
		utmCampaign: 'launch',
		utmContent: 'hero',
		utmTerm: 'boots',
		country: 'DE',
		region: 'BE',
		city: 'Berlin',
		language: 'de-de',
		device: 'desktop',
		browser: 'chrome',
		os: 'macos',
		scrollDepth: 0,
		props: { plan: 'pro', seats: 3, trial: true },
	}),
	hit({
		id: ulid(AT),
		scope: 'tenant-a',
		type: 'engagement',
		lastAt: new Date('2026-10-06T10:04:30.456Z'),
		landing: false,
		durationMs: 4000,
		scrollDepth: 35,
		impressions: ['offers:1', 'offers:2'],
	}),
	hit({
		id: 'os.0123456789abcdef',
		scope: 'tenant-a',
		type: 'goal',
		landing: false,
		server: true,
		name: 'purchase',
		source: 'direct',
		channel: 'direct',
		channelVersion: 1,
		value: 12.5,
		originalValue: 1999,
		currency: 'EUR',
		originalCurrency: 'JPY',
		conversions: 2,
		revenue: 12.5,
		item: 'offers:1',
		props: { orderId: 'ord_1', items: [{ id: 'sku-1', quantity: 2 }] },
		goals: [
			{ slug: 'purchase', value: 12.5 },
			{ slug: 'any-sale', value: 0 },
		],
	}),
	hit({ id: ulid(AT), type: 'event', name: 'export', landing: false, server: true, v: '' }),
]

describeForDb('engine hit store', {}, (db) => {
	let first: BootedPayload
	let second: BootedPayload
	let a: EventStore
	let b: EventStore

	beforeAll(async () => {
		first = await bootPayload({ db, plugin: plugin() })
		second = await bootPayload({ db, plugin: plugin(), attachTo: first })
		a = createEventStore(first.payload)
		b = createEventStore(second.payload)
	}, 240_000)

	afterAll(async () => {
		await second?.stop()
		await first?.stop()
	})

	beforeEach(async () => {
		if (db === 'mongo') {
			const models = Reflect.get(first.payload.db, 'collections') as Record<
				string,
				{ deleteMany: (filter: object) => Promise<unknown> }
			>
			await models[HITS_SLUG]?.deleteMany({})
			return
		}
		const executor = createSqlExecutor(first.payload)
		await executor.execute(sql`DELETE FROM ${executor.table(HITS_SLUG)}`)
	})

	/** Every stored hit, read through Payload's own adapter, by id. */
	const stored = async (): Promise<Array<Record<string, unknown>>> =>
		(
			await first.payload.find({
				collection: HITS_SLUG,
				pagination: false,
				sort: 'id',
				depth: 0,
			})
		).docs.map((doc) => present(doc))

	const count = async (): Promise<number> =>
		(await first.payload.db.count({ collection: HITS_SLUG, where: {}, req: {} })).totalDocs

	it('writes one row per hit, every field read back through Payload with its own type', async () => {
		expect(await a.append(VISIT)).toEqual({ written: 4, duplicates: 0 })
		const rows = await stored()
		const byId = new Map(rows.map((row) => [row.id, row]))
		for (const row of VISIT) {
			expect(byId.get(row.id)).toEqual(asRead(row))
		}
		const sale = byId.get('os.0123456789abcdef')
		expect(typeof sale?.value).toBe('number')
		expect(sale?.server).toBe(true)
		expect(sale?.landing).toBe(false)
		expect(byId.get(VISIT[3]?.id)?.v).toBe('')
	})

	it('refuses a second row for an id it holds, keeping the first, and counts it', async () => {
		const [first, second, third] = many(3, 'D')
		if (!first || !second || !third) {
			throw new Error('three hits were made')
		}
		expect(await a.append([first, second])).toEqual({ written: 2, duplicates: 0 })
		expect(
			await a.append([{ ...first, path: '/rewritten' }, third, { ...third, path: '/twice' }])
		).toEqual({ written: 1, duplicates: 2 })
		const rows = await stored()
		expect(rows.map((row) => [row.id, row.path])).toEqual([
			[first.id, first.path],
			[second.id, second.path],
			[third.id, third.path],
		])
	})

	it('writes past 500 hits in chunks of 500', async () => {
		const hits = many(1234, 'C')
		expect(await a.append(hits)).toEqual({ written: 1234, duplicates: 0 })
		expect(await count()).toBe(1234)
		expect(await a.append(hits.slice(400, 900))).toEqual({ written: 0, duplicates: 500 })
		expect(await count()).toBe(1234)
	})

	it('reads nothing while it writes: one INSERT per chunk, and no query of any kind', async () => {
		const statements: string[] = []
		const adapter = first.payload.db
		const reads = (['find', 'findOne', 'count', 'findDistinct', 'queryDrafts'] as const).map(
			(method) => vi.spyOn(adapter, method)
		)
		let stop: () => void = () => undefined
		let store = a
		if (db === 'mongo') {
			const connection = Reflect.get(adapter, 'connection') as {
				on: (event: string, listener: (op: { method: string }) => void) => void
				off: (event: string, listener: (op: { method: string }) => void) => void
			}
			const listener = (op: { method: string }) => {
				statements.push(op.method)
			}
			connection.on('operation-start', listener)
			stop = () => connection.off('operation-start', listener)
		} else {
			// What the engine sends, on whichever thread SQLite runs it.
			const executor = createSqlExecutor(first.payload)
			const text = (fragment: SqlFragment) => compile(fragment, executor.dialect).text
			const select = vi.spyOn(executor, 'select')
			const execute = vi.spyOn(executor, 'execute')
			const batch = vi.spyOn(executor, 'batch')
			store = createEventStore(first.payload, { executor })
			stop = () => {
				for (const [fragment] of [...select.mock.calls, ...execute.mock.calls]) {
					statements.push(text(fragment))
				}
				for (const [list] of batch.mock.calls) {
					statements.push(...list.map(({ statement }) => text(statement)))
				}
			}
		}
		try {
			await store.append(many(700, 'R'))
		} finally {
			stop()
		}
		for (const read of reads) {
			expect(read).not.toHaveBeenCalled()
			read.mockRestore()
		}
		expect(statements).toHaveLength(2)
		for (const text of statements) {
			expect(text).toMatch(db === 'mongo' ? /^insertMany$/ : /^INSERT INTO /)
		}
	})

	// The same ids from both instances at once, in opposite orders: a writer waits on the other's
	// uncommitted rows, which deadlocks on Postgres unless rows are sorted.
	it('takes two instances appending at once, each id stored once', async () => {
		const appends = [a.append(many(400, 'A')), b.append(many(400, 'B'))]
		for (let round = 0; round < 4; round++) {
			const shared = many(500, `S${round}`)
			const backwards = [...shared].reverse()
			for (let i = 0; i < 6; i++) {
				appends.push((i % 2 === 0 ? a : b).append(i % 4 < 2 ? shared : backwards))
			}
		}
		const results = await Promise.all(appends)
		const written = results.reduce((sum, result) => sum + result.written, 0)
		const duplicates = results.reduce((sum, result) => sum + result.duplicates, 0)
		expect(written).toBe(400 + 400 + 4 * 500)
		expect(written + duplicates).toBe(400 + 400 + 4 * 6 * 500)
		expect(await count()).toBe(2800)
	})

	it('stores what ingest normalizes, and one row however often an order arrives', async () => {
		const receivedAt = new Date()
		/** A browser's beacon, or server code with no visitor behind it at all. */
		const normalize = (raw: RawEventInput, origin: 'wire' | 'server') =>
			normalizeEvent({
				raw,
				hostname: 'shop.example',
				headers: new Headers(
					origin === 'wire'
						? { 'user-agent': 'UA', 'x-real-ip': '9.9.9.9' }
						: { 'user-agent': SERVER_USER_AGENT }
				),
				geoResolver: noopResolver,
				salt: 'salt-1',
				now: eventTime(raw, receivedAt),
				origin,
				goals: [{ slug: 'purchase', name: 'Purchase', match: { kind: 'goal' } }],
			})
		const engagement: RawEventInput = {
			type: 'engagement',
			path: '/pricing',
			durationMs: 4000,
			sinceMs: 90_000,
		}
		const sale: RawEventInput = {
			type: 'goal',
			name: 'purchase',
			path: '/orders/1',
			revenue: true,
			value: 49,
			orderId: 'ord_1',
		}
		const hits = [
			toHit(await normalize({ type: 'pageview', path: '/pricing', nav: 1 }, 'wire'), {
				receivedAt,
			}),
			toHit(await normalize(engagement, 'wire'), { receivedAt }),
			toHit(await normalize(sale, 'server'), { receivedAt }),
		]
		expect(await a.append(hits)).toEqual({ written: 3, duplicates: 0 })
		const retry = toHit(await normalize(sale, 'server'), {
			receivedAt: new Date(),
		})
		expect(await b.append([retry])).toEqual({ written: 0, duplicates: 1 })

		const rows = await stored()
		expect(rows).toHaveLength(3)
		const read = rows.find((row) => row.type === 'engagement')
		expect(read?.ts).toBe(new Date(receivedAt.getTime() - 90_000).toISOString())
		expect(read?.lastAt).toBe(receivedAt.toISOString())
		expect(rows.find((row) => row.type === 'pageview')).toMatchObject({
			landing: false,
			source: 'direct',
		})
		expect(rows.find((row) => row.type === 'goal')).toMatchObject({
			id: expect.stringMatching(/^os\./),
			server: true,
			v: '',
			conversions: 1,
			revenue: 49,
		})
	})

	// SQLite runs no transaction unless the host sets transactionOptions, and then a write outside
	// it waits on its lock: the store never takes part in one either way.
	it.runIf(db !== 'sqlite')(
		'keeps its rows when a transaction the host had open rolls back',
		async () => {
			const { payload } = first
			const transactionID = await payload.db.beginTransaction()
			expect(transactionID).toBeTruthy()
			const hostRow = hit({ id: 'host-row' })
			await payload.db.create({
				collection: HITS_SLUG,
				data: { ...hostRow, ts: hostRow.ts.toISOString() },
				req: { transactionID: transactionID ?? undefined },
			})
			const ours = hit({ id: ulid(AT) })
			expect(await a.append([ours])).toEqual({ written: 1, duplicates: 0 })
			if (transactionID) {
				await payload.db.rollbackTransaction(transactionID)
			}
			expect((await stored()).map((row) => row.id)).toEqual([ours.id])
		}
	)
})
