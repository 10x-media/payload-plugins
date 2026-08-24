import { type BootedPayload, bootPayload, describeForDb } from '@10x-media/payload-test-harness'
import { afterAll, beforeAll, expect, it } from 'vitest'
import { analytics } from '../../src/index'
import { platformHeaderResolver } from '../../src/native/geo/geoResolver'
import { makeIngestHandler } from '../../src/native/ingest/endpoint'
import { native } from '../../src/native/nativeAdapter'

interface IngestOpts {
	path: string
	hostname: string
	ua: string
}

const ingest = (booted: BootedPayload, opts: IngestOpts) =>
	makeIngestHandler(platformHeaderResolver)({
		payload: booted.payload,
		headers: new Headers({ 'content-type': 'application/json', 'user-agent': opts.ua }),
		json: async () => ({ type: 'pageview', path: opts.path, hostname: opts.hostname }),
	} as never)

const RANGE = { start: new Date('2020-01-01'), end: new Date('2030-01-01') }
// The visitor hash is salted with the hostname, so the same UA on two hostnames is two
// distinct visitors: UA1 on a.example never collides with UA1 on b.example.
const UA1 = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120'
const UA2 = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0) Mobile/15E148'

describeForDb('native hostname-scoped rollups', { dbs: ['mongo'] }, (db) => {
	const adapter = native()
	let booted: BootedPayload

	beforeAll(async () => {
		booted = await bootPayload({ plugin: analytics({ adapters: [adapter] }), db })
		// a.example: a repeat visitor (UA1 hits '/x' twice) plus a second distinct visitor.
		await ingest(booted, { path: '/x', hostname: 'a.example', ua: UA1 })
		await ingest(booted, { path: '/x', hostname: 'a.example', ua: UA1 })
		await ingest(booted, { path: '/y', hostname: 'a.example', ua: UA2 })
		// b.example: one hit from a UA that also appears on a.example, but hashes distinct.
		await ingest(booted, { path: '/x', hostname: 'b.example', ua: UA1 })
	})

	afterAll(async () => {
		await booted.stop()
	})

	it('unfiltered totals count every hostname, exact for the merged bucket', async () => {
		const result = await adapter.query(
			{ metrics: ['pageviews', 'visitors', 'sessions'], dateRange: RANGE },
			{}
		)
		expect(result.totals?.pageviews).toBe(4)
		expect(result.totals?.visitors).toBe(3)
		expect(result.totals?.sessions).toBe(3)
	})

	it('a hostname query pins the exact hostname family', async () => {
		const a = await adapter.query(
			{ metrics: ['pageviews', 'visitors', 'sessions'], dateRange: RANGE, hostname: 'a.example' },
			{}
		)
		expect(a.totals?.pageviews).toBe(3)
		expect(a.totals?.visitors).toBe(2)
		expect(a.totals?.sessions).toBe(2)

		const b = await adapter.query(
			{ metrics: ['pageviews', 'visitors', 'sessions'], dateRange: RANGE, hostname: 'b.example' },
			{}
		)
		expect(b.totals?.pageviews).toBe(1)
		expect(b.totals?.visitors).toBe(1)
		expect(b.totals?.sessions).toBe(1)
	})

	it('neither family double-counts a repeat visitor across dual-emitted buckets', async () => {
		// Same UA1/a.example repeat as in beforeAll. Pageviews rise in both families, but
		// the visitor was already seen in each family's own ledger, so distinct counts hold.
		await ingest(booted, { path: '/x', hostname: 'a.example', ua: UA1 })

		const merged = await adapter.query({ metrics: ['pageviews', 'visitors'], dateRange: RANGE }, {})
		expect(merged.totals?.pageviews).toBe(5)
		expect(merged.totals?.visitors).toBe(3)

		const a = await adapter.query(
			{ metrics: ['pageviews', 'visitors'], dateRange: RANGE, hostname: 'a.example' },
			{}
		)
		expect(a.totals?.pageviews).toBe(4)
		expect(a.totals?.visitors).toBe(2)
	})
})
