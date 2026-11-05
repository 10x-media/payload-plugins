import {
	type BootedPayload,
	bootPayload,
	describeForDb,
	installTestClock,
	type TestClock,
} from '@10x-media/payload-test-harness'
import { afterAll, beforeAll, expect, it } from 'vitest'
import { analytics } from '../../src/index'
import { platformHeaderResolver } from '../../src/native/geo/geoResolver'
import { makeIngestHandler } from '../../src/native/ingest/endpoint'
import { trackServerEvent } from '../../src/native/ingest/serverTrack'
import { native } from '../../src/native/nativeAdapter'
import { ingestRequest } from './ingestRequest'
import { aroundNow, nativeOf, storedHits } from './nativeHelpers'

interface IngestOpts {
	path: string
	hostname: string
	ua: string
}

// The hostname travels as the request's own Host: an event is attributed to the request, and
// the body's claim (deliberately a different value here) is ignored.
const ingest = (booted: BootedPayload, opts: IngestOpts) =>
	makeIngestHandler({ geoResolver: platformHeaderResolver, target: nativeOf })(
		ingestRequest(
			booted.payload,
			{ type: 'pageview', path: opts.path, hostname: 'claimed.example' },
			{ 'user-agent': opts.ua, host: opts.hostname }
		)
	)

interface SendArgs {
	booted: BootedPayload
	path?: string
	body: Record<string, unknown>
	headers: Record<string, string>
}

const sendTo = ({ booted, path = '/_x/e', body, headers }: SendArgs) => {
	const endpoint = booted.payload.config.endpoints?.find((e) => e.path === path)
	if (!endpoint) {
		throw new Error(`endpoint ${path} not registered`)
	}
	return endpoint.handler(ingestRequest(booted.payload, body, headers))
}

const storedHostnames = async (booted: BootedPayload, path: string): Promise<string[]> =>
	(await storedHits(booted.payload, { path: { equals: path } })).map((hit) => String(hit.hostname))

// The visitor hash is salted with the hostname, so the same UA on two hostnames is two
// distinct visitors: UA1 on a.example never collides with UA1 on b.example.
const UA1 = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120'
const UA2 = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0) Mobile/15E148'

describeForDb('native hostname-scoped reads', {}, (db) => {
	const adapter = native()
	let booted: BootedPayload
	let clock: TestClock

	beforeAll(async () => {
		// Held still: a visitor's hash changes with its day's salt, so a repeat visit must land on
		// the first one's day however late the run reaches it.
		clock = installTestClock(new Date())
		booted = await bootPayload({
			plugin: analytics({ adapters: [adapter], capture: { gate: 'off' } }),
			db,
		})
		// a.example: a repeat visitor (UA1 hits '/x' twice) plus a second distinct visitor.
		await ingest(booted, { path: '/x', hostname: 'a.example', ua: UA1 })
		await ingest(booted, { path: '/x', hostname: 'a.example', ua: UA1 })
		await ingest(booted, { path: '/y', hostname: 'a.example', ua: UA2 })
		// b.example: one hit from a UA that also appears on a.example, but hashes distinct.
		await ingest(booted, { path: '/x', hostname: 'b.example', ua: UA1 })
	})

	afterAll(async () => {
		clock?.reset()
		await booted.stop()
	})

	it('unfiltered totals count every hostname, exact for the merged bucket', async () => {
		const result = await adapter.query(
			{ metrics: ['pageviews', 'visitors', 'sessions'], dateRange: aroundNow() },
			{ payload: booted.payload }
		)
		expect(result.totals?.pageviews).toBe(4)
		expect(result.totals?.visitors).toBe(3)
		expect(result.totals?.sessions).toBe(3)
	})

	it('a hostname query pins the exact hostname family', async () => {
		const a = await adapter.query(
			{
				metrics: ['pageviews', 'visitors', 'sessions'],
				dateRange: aroundNow(),
				hostname: 'a.example',
			},
			{ payload: booted.payload }
		)
		expect(a.totals?.pageviews).toBe(3)
		expect(a.totals?.visitors).toBe(2)
		expect(a.totals?.sessions).toBe(2)

		const b = await adapter.query(
			{
				metrics: ['pageviews', 'visitors', 'sessions'],
				dateRange: aroundNow(),
				hostname: 'b.example',
			},
			{ payload: booted.payload }
		)
		expect(b.totals?.pageviews).toBe(1)
		expect(b.totals?.visitors).toBe(1)
		expect(b.totals?.sessions).toBe(1)
	})

	it('counts a repeat visitor once on its own host and once across hosts', async () => {
		// Same UA1/a.example repeat as in beforeAll. Pageviews rise, but the visitor is one
		// person on a.example, so the distinct counts hold on that host and across both.
		await ingest(booted, { path: '/x', hostname: 'a.example', ua: UA1 })

		const merged = await adapter.query(
			{ metrics: ['pageviews', 'visitors'], dateRange: aroundNow() },
			{ payload: booted.payload }
		)
		expect(merged.totals?.pageviews).toBe(5)
		expect(merged.totals?.visitors).toBe(3)

		const a = await adapter.query(
			{ metrics: ['pageviews', 'visitors'], dateRange: aroundNow(), hostname: 'a.example' },
			{ payload: booted.payload }
		)
		expect(a.totals?.pageviews).toBe(4)
		expect(a.totals?.visitors).toBe(2)
	})
})

describeForDb('native ingest attribution', {}, (db) => {
	const adapter = native()
	let booted: BootedPayload

	beforeAll(async () => {
		booted = await bootPayload({
			plugin: analytics({ adapters: [adapter], capture: { gate: 'off' } }),
			db,
		})
	})

	afterAll(async () => {
		await booted.stop()
	})

	const send = (body: Record<string, unknown>, headers: Record<string, string>) =>
		sendTo({ booted, body, headers })

	const hostnamesFor = async (path: string): Promise<string[]> =>
		[...new Set(await storedHostnames(booted, path))].sort()

	it('stores the request host, ignoring the body claim and the Origin header', async () => {
		const res = await send(
			{ type: 'pageview', path: '/forged', hostname: 'evil.example' },
			{ host: 'real.example:3000', origin: 'https://other.example' }
		)
		expect(res.status).toBe(202)
		expect(await storedHostnames(booted, '/forged')).toEqual(['real.example'])
	})

	it('stores one hostname however many hostnames a client claims', async () => {
		for (let i = 0; i < 200; i++) {
			await send(
				{ type: 'pageview', path: '/flood', hostname: `mint-${i}.example` },
				{ host: 'real.example' }
			)
		}
		expect(await hostnamesFor('/flood')).toEqual(['real.example'])
	})

	it('hashes the visitor and reads self-referral against the resolved hostname', async () => {
		await send(
			{
				type: 'pageview',
				path: '/self',
				hostname: 'evil.example',
				referrer: 'https://real.example/a',
			},
			{ host: 'real.example', 'user-agent': UA1 }
		)
		await send(
			{ type: 'pageview', path: '/self', hostname: 'evil.example' },
			{ host: 'real.example', 'user-agent': UA1 }
		)
		const rows = await storedHits(booted.payload, { path: { equals: '/self' } })
		// SQL answers a null column, Mongo omits the field: neither is a referrer.
		expect(rows.map((row) => row.ref ?? undefined)).toEqual([undefined, undefined])
		expect(rows.map((row) => row.landing)).toEqual([false, true])
		expect(new Set(rows.map((row) => row.v)).size).toBe(1)
	})

	it('leaves the hostname trackServerEvent passes alone', async () => {
		await trackServerEvent(booted.payload, {
			type: 'event',
			name: 'invoice_paid',
			path: '/hook',
			hostname: 'server.example',
		})
		expect(await storedHostnames(booted, '/hook')).toEqual(['server.example'])
	})
})

describeForDb('native ingest hostname list form', {}, (db) => {
	let booted: BootedPayload

	beforeAll(async () => {
		booted = await bootPayload({
			db,
			plugin: analytics({
				capture: { gate: 'off' },
				adapters: [native({ hostname: ['listed.example'] })],
			}),
		})
	})

	afterAll(async () => {
		await booted.stop()
	})

	it('keeps a listed request host and drops an unlisted one', async () => {
		await sendTo({
			booted,
			body: { type: 'pageview', path: '/list' },
			headers: { host: 'Listed.example' },
		})
		await sendTo({
			booted,
			body: { type: 'pageview', path: '/list', hostname: 'listed.example' },
			headers: { host: 'other.example' },
		})
		expect(await storedHostnames(booted, '/list')).toEqual(['listed.example'])
	})
})

describeForDb('native ingest hostname resolver form', {}, (db) => {
	let booted: BootedPayload
	const seen: Array<{ claimed: string | undefined; scope: string | null }> = []

	beforeAll(async () => {
		booted = await bootPayload({
			db,
			plugin: analytics({
				capture: { gate: 'off' },
				adapters: [
					native({
						hostname: ({ claimed, scope }) => {
							seen.push({ claimed, scope })
							if (claimed === 'boom.example') {
								throw new Error('lookup failed')
							}
							return claimed === 'drop.example' ? null : 'Resolved.Example'
						},
					}),
				],
			}),
		})
	})

	afterAll(async () => {
		await booted.stop()
	})

	it('stores what a resolver answers, and drops on null or a throw', async () => {
		for (const hostname of ['claimed.example', 'drop.example', 'boom.example']) {
			const res = await sendTo({
				booted,
				body: { type: 'pageview', path: '/fn', hostname },
				headers: { host: 'real.example' },
			})
			expect(res.status).toBe(202)
		}
		expect(await storedHostnames(booted, '/fn')).toEqual(['resolved.example'])
		expect(seen[0]).toEqual({ claimed: 'claimed.example', scope: null })
	})
})
