import { type BootedPayload, bootPayload, describeForDb } from '@10x-media/payload-test-harness'
import { reload } from 'payload'
import { afterAll, beforeAll, expect, it } from 'vitest'
import { analytics } from '../../src/index'
import { trackServerEvent } from '../../src/native/ingest/serverTrack'
import { native } from '../../src/native/nativeAdapter'
import { aroundNow, nativeOf } from './nativeHelpers'

const HOST = 'reload.example'

/**
 * A dev server's hot reload with the config unchanged closes MongoDB's connection, deletes every
 * model and compiles new ones, while the runtime the config keeps holds on to its engine.
 */
describeForDb('the native engine across a dev reload', { dbs: ['mongo'] }, (db) => {
	let booted: BootedPayload

	beforeAll(async () => {
		booted = await bootPayload({
			db,
			plugin: analytics({ adapters: [native()], capture: { gate: 'off' }, jobs: false }),
		})
	}, 240_000)

	afterAll(async () => {
		await booted?.stop()
	})

	it(`tracks, reads and keeps its state rows after a reload of the same config, on ${db}`, async () => {
		await trackServerEvent(booted.payload, { type: 'pageview', path: '/before', hostname: HOST })
		const engine = nativeOf(booted.payload).engine
		await reload(booted.payload.config, booted.payload, true)
		expect(nativeOf(booted.payload).engine).toBe(engine)
		await trackServerEvent(booted.payload, { type: 'pageview', path: '/after', hostname: HOST })
		const read = await engine.read({
			metrics: ['pageviews'],
			hostname: HOST,
			dateRange: aroundNow(),
		})
		expect(read.totals).toEqual({ pageviews: 2 })
		// Tracking started maintenance in the background, which holds its lease until it ends.
		await engine.idle()
		expect(await engine.maintain({ budgetMs: 30_000 })).toMatchObject({ ran: true })
	})
})
