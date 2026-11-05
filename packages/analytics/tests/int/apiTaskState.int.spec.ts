import { type BootedPayload, bootPayload, describeForDb } from '@10x-media/payload-test-harness'
import type { Payload, PayloadRequest } from 'payload'
import { afterAll, beforeAll, expect, it } from 'vitest'
import { DEFAULT_JOBS, TASK_SLUGS } from '../../src/core/jobs'
import { analytics } from '../../src/index'
import { apiTaskState } from '../../src/maintenance/apiTaskState'
import { stateStoreOf, TASK_LEASE_MS } from '../../src/maintenance/lease'
import { STATE_SLUG } from '../../src/native/collections/slugs'
import { leaseKey } from '../../src/native/store/state'
import { settleRetiredRuntimes } from '../../src/plugin/runtime'
import { REKEY_CURSOR } from '../../src/sync/rekeyDurations'
import { syncTask, upsertSyncRow } from '../../src/sync/syncTask'
import { memoryAdapter } from '../../src/testing/memoryAdapter'

const D1_PACKAGE = '@payloadcms/db-d1-sqlite'
const DAY = 86_400_000

const jobReq = (payload: Payload): PayloadRequest => ({ payload }) as PayloadRequest

const ranOf = (result: unknown): boolean | undefined => {
	const output =
		typeof result === 'object' && result !== null && 'output' in result ? result.output : undefined
	return typeof output === 'object' && output !== null && 'ran' in output
		? output.ran === true
		: undefined
}

const stateIds = async (payload: Payload): Promise<string[]> => {
	const { docs } = await payload.find({
		collection: STATE_SLUG as never,
		pagination: false,
		overrideAccess: true,
	})
	return docs.map((doc) => String(doc.id)).sort()
}

// Cloudflare D1 cannot run here, so each database stands in for it through Payload's database API
// alone, which is all the store uses: an adapter that names D1's package gets it from the plugin.
describeForDb('task state through the database API, as on Cloudflare D1', {}, (db) => {
	let first: BootedPayload
	let second: BootedPayload

	const plugin = () =>
		analytics({
			adapters: [memoryAdapter()],
			capture: { gate: 'off' },
			sync: true,
			jobs: { queue: 'analytics' },
		})

	beforeAll(async () => {
		first = await bootPayload({ db, disableOnInit: true, plugin: plugin() })
		second = await bootPayload({ db, attachTo: first, disableOnInit: true, plugin: plugin() })
		for (const booted of [first, second]) {
			Object.assign(booted.payload.db, { packageName: D1_PACKAGE })
		}
	}, 240_000)

	afterAll(async () => {
		await settleRetiredRuntimes(second.payload)
		await settleRetiredRuntimes(first.payload)
		await second.stop()
		await first.stop()
	})

	it(`gives a lease to one of several claimers on two instances at once on ${db}`, async () => {
		const key = leaseKey('api-race')
		const stores = [first, second].map((booted) =>
			apiTaskState(booted.payload, { slug: STATE_SLUG })
		)
		const won = await Promise.all(
			[0, 1, 2, 3, 4, 5].map((n) => stores[n % 2]?.claim(key, `owner-${n}`, TASK_LEASE_MS))
		)
		const winner = won.findIndex(Boolean)
		expect(won.filter(Boolean)).toHaveLength(1)
		expect(await stores[1]?.held(key)).toBe(true)

		expect(await stores[winner % 2]?.claim(key, `owner-${winner}`, TASK_LEASE_MS)).toBe(true)
		expect(await stores[0]?.release(key, `owner-${winner}`)).toBe(true)
		expect(await stores[1]?.held(key)).toBe(false)
		expect(await stores[1]?.claim(key, 'next', TASK_LEASE_MS)).toBe(true)
		await stores[1]?.release(key, 'next')
	})

	it(`keeps heartbeats and cursors, written from two instances at once, on ${db}`, async () => {
		const [one, two] = [first, second].map((booted) =>
			apiTaskState(booted.payload, { slug: STATE_SLUG })
		)
		await Promise.all([one?.beat('api-task'), two?.beat('api-task')])
		expect(await one?.lastBeat('api-task')).toBeInstanceOf(Date)
		await Promise.all([one?.setCursor('api-task', 'a'), two?.setCursor('api-task', 'a')])
		expect(await two?.cursor('api-task')).toBe('a')
		await one?.setCursor('api-task', null)
		expect(await two?.cursor('api-task')).toBeNull()
	})

	it(`runs a sync once from two workers, with its heartbeat and its duration move, on ${db}`, async () => {
		await upsertSyncRow(first.payload, 'analytics-daily', {
			source: 'plausible',
			date: new Date(Date.UTC(2026, 0, 1)),
			syncedAt: new Date(Date.now() - 30 * DAY),
			scope: '',
			avgDuration: 42_000,
		})
		const sync = syncTask({
			schedule: DEFAULT_JOBS.sync,
			lookbackDays: 3,
			collectionSlug: 'analytics-daily',
		})
		const handler: unknown = sync.handler
		if (typeof handler !== 'function') {
			throw new Error('the task runs a function')
		}

		const ran = await Promise.all(
			[first, second].map(async (booted) => ranOf(await handler({ req: jobReq(booted.payload) })))
		)

		expect(ran.sort()).toEqual([false, true])
		const state = stateStoreOf(first.payload)
		expect(await state?.lastBeat(TASK_SLUGS.sync)).toBeInstanceOf(Date)
		expect(await state?.cursor(REKEY_CURSOR)).toBe('done')
		const { docs } = await first.payload.find({
			collection: 'analytics-daily' as never,
			where: { source: { equals: 'plausible' } },
		})
		expect(docs.map((doc) => (doc as { visitDuration?: number }).visitDuration)).toEqual([42_000])
		// Released slot rows are gone, where the SQL store would keep its `lease:analytics-sync` row.
		const syncSlots = (await stateIds(first.payload)).filter((id) =>
			id.startsWith(`${leaseKey(TASK_SLUGS.sync)}@`)
		)
		expect(syncSlots).toEqual([])
	})
})
