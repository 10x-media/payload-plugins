import { type BootedPayload, bootPayload, describeForDb } from '@10x-media/payload-test-harness'
import type { Config, PayloadHandler } from 'payload'
import { afterAll, beforeAll, expect, it } from 'vitest'
import { analytics } from '../../src/index'
import { EVENTS_SLUG } from '../../src/native/collections/events'
import { trackServerEvent } from '../../src/native/ingest/serverTrack'
import { type NativeOptions, native } from '../../src/native/nativeAdapter'
import { ingestRequest } from './ingestRequest'

const GOOGLEBOT = 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)'
const CHROME =
	'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36'

/**
 * The ingest endpoint an install's own options build, taken from the config the adapter
 * registers: the option has to reach the handler, not just the predicate it resolves to.
 */
const endpointFor = (options: NativeOptions): PayloadHandler => {
	const config = {} as Config
	native(options).register?.(config)
	const endpoint = config.endpoints?.find((e) => e.path === '/analytics/ingest')
	if (!endpoint) {
		throw new Error('ingest endpoint not registered')
	}
	return endpoint.handler
}

describeForDb('native bot filtering', {}, (db) => {
	let booted: BootedPayload

	beforeAll(async () => {
		booted = await bootPayload({ plugin: analytics({ adapters: [native()] }), db })
	})

	afterAll(async () => {
		await booted.stop()
	})

	const send = async (handler: PayloadHandler, path: string, ua: string): Promise<Response> =>
		await handler(
			ingestRequest(booted.payload, { type: 'pageview', path, hostname: 'h' }, { 'user-agent': ua })
		)

	const stored = async (path: string): Promise<number> => {
		const { totalDocs } = await booted.payload.count({
			collection: EVENTS_SLUG as never,
			where: { path: { equals: path } },
		})
		return totalDocs
	}

	it('answers a crawler exactly like a visitor and stores nothing', async () => {
		const handler = endpointFor({})
		const kept = await send(handler, '/bots-human', CHROME)
		const dropped = await send(handler, '/bots-crawler', GOOGLEBOT)
		expect(dropped.status).toBe(kept.status)
		expect(await dropped.text()).toBe(await kept.text())
		expect([...dropped.headers].sort()).toEqual([...kept.headers].sort())
		expect(await stored('/bots-human')).toBe(1)
		expect(await stored('/bots-crawler')).toBe(0)
	})

	it('counts the crawler when filtering is turned off', async () => {
		const res = await send(endpointFor({ filterBots: false }), '/bots-off', GOOGLEBOT)
		expect(res.status).toBe(202)
		expect(await stored('/bots-off')).toBe(1)
	})

	it('honours an install filter of its own, in both directions', async () => {
		const handler = endpointFor({ filterBots: (ua) => ua.includes('internal-probe') })
		await send(handler, '/bots-own-drop', 'internal-probe/1.0')
		await send(handler, '/bots-own-keep', GOOGLEBOT)
		expect(await stored('/bots-own-drop')).toBe(0)
		expect(await stored('/bots-own-keep')).toBe(1)
	})

	it('keeps the event when an install filter throws', async () => {
		const handler = endpointFor({
			filterBots: () => {
				throw new Error('boom')
			},
		})
		const res = await send(handler, '/bots-throwing', GOOGLEBOT)
		expect(res.status).toBe(202)
		expect(await stored('/bots-throwing')).toBe(1)
	})

	// Server tracking is host code the install wrote, so it is trusted whatever agent it
	// attributes the event to: a webhook standing in for a crawler's own fetch still counts.
	it('never filters a trusted server event, even with a crawler agent', async () => {
		await trackServerEvent(booted.payload, {
			type: 'event',
			name: 'invoice_paid',
			path: '/bots-server',
			hostname: 'h',
			userAgent: GOOGLEBOT,
		})
		expect(await stored('/bots-server')).toBe(1)
	})
})
