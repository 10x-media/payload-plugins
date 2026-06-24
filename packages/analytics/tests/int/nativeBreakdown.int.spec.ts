import { type BootedPayload, bootPayload, describeForDb } from '@10x-media/payload-test-harness'
import { afterAll, beforeAll, expect, it } from 'vitest'
import { analytics } from '../../src/index'
import { platformHeaderResolver } from '../../src/native/geo/geoResolver'
import { makeIngestHandler } from '../../src/native/ingest/endpoint'
import { native } from '../../src/native/nativeAdapter'

interface IngestOpts {
	path: string
	ua: string
	referrer?: string
}

const ingest = (booted: BootedPayload, opts: IngestOpts) =>
	makeIngestHandler(platformHeaderResolver)({
		payload: booted.payload,
		headers: new Headers({ 'content-type': 'application/json', 'user-agent': opts.ua }),
		json: async () => ({
			type: 'pageview',
			path: opts.path,
			hostname: 'example.com',
			referrer: opts.referrer,
		}),
	} as never)

const DESKTOP = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120'
const PHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0) Mobile/15E148'
const RANGE = { start: new Date('2020-01-01'), end: new Date('2030-01-01') }

describeForDb('native dimension breakdowns', { dbs: ['mongo'] }, (db) => {
	const adapter = native()
	let booted: BootedPayload

	beforeAll(async () => {
		booted = await bootPayload({ plugin: analytics({ adapters: [adapter] }), db })
		await ingest(booted, { path: '/a', ua: DESKTOP, referrer: 'https://www.google.com/' })
		await ingest(booted, { path: '/b', ua: DESKTOP, referrer: 'https://www.google.com/' })
		await ingest(booted, { path: '/c', ua: PHONE, referrer: 'https://t.co/x' })
	})

	afterAll(async () => {
		await booted.stop()
	})

	it('breaks pageviews down by source', async () => {
		const result = await adapter.query(
			{ metrics: ['pageviews'], dimensions: ['source'], dateRange: RANGE },
			{}
		)
		const bySource = Object.fromEntries(
			result.rows.map((r) => [r.dimensions?.source, r.metrics.pageviews])
		)
		expect(bySource['google.com']).toBe(2)
		expect(bySource['t.co']).toBe(1)
	})

	it('breaks pageviews down by device', async () => {
		const result = await adapter.query(
			{ metrics: ['pageviews'], dimensions: ['device'], dateRange: RANGE },
			{}
		)
		const byDevice = Object.fromEntries(
			result.rows.map((r) => [r.dimensions?.device, r.metrics.pageviews])
		)
		expect(byDevice.desktop).toBe(2)
		expect(byDevice.mobile).toBe(1)
	})
})
