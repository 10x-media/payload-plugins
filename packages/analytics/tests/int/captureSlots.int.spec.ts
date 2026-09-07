import { type BootedPayload, bootPayload, describeForDb } from '@10x-media/payload-test-harness'
import { HttpResponse, http } from 'msw'
import { setupServer } from 'msw/node'
import { handleEndpoints } from 'payload'
import { afterAll, beforeAll, expect, it } from 'vitest'
import type { TrackerConfig } from '../../src/capture/trackerConfig'
import type { CaptureSupport } from '../../src/core/capture'
import type { AnalyticsAdapter } from '../../src/core/contract'
import { analytics } from '../../src/index'
import { native } from '../../src/native/nativeAdapter'
import { memoryAdapter } from '../../src/testing/memoryAdapter'

const INGEST = 'https://ingest.vendor.test'

const vendorCapture: CaptureSupport = {
	proxy: { routes: [{ source: '/:p*', upstream: `${INGEST}/:p*` }] },
	snippet: () => ({ scripts: [] }),
	client: { kind: 'posthog' },
}

const vendorAdapter = (): AnalyticsAdapter => ({
	...memoryAdapter(),
	id: 'vendor',
	label: 'vendor',
	capture: vendorCapture,
})

/** Every request resolves a scope, so the tenant slot is always in play. */
const alwaysScoped = () => 'tenant-a'

const trackerConfig = async (booted: BootedPayload): Promise<TrackerConfig> => {
	const res = await handleEndpoints({
		config: booted.payload.config,
		payloadInstanceCacheKey: booted.cacheKey,
		request: new Request('http://localhost:3000/api/analytics/tracker'),
	})
	expect(res.status).toBe(200)
	return (await res.json()) as TrackerConfig
}

describeForDb('analytics capture slots - one adapter, one slot', { dbs: ['mongo'] }, (db) => {
	let booted: BootedPayload

	beforeAll(async () => {
		booted = await bootPayload({
			db,
			plugin: analytics({
				adapters: [native()],
				scopeResolver: alwaysScoped,
				// Both slots land on native: the global one by this override, the tenant one
				// because native is the scope registry's only (so default) adapter.
				capture: { slots: { global: 'native' } },
			}),
		})
	}, 240_000)

	afterAll(async () => {
		await booted.stop()
	})

	// Two entries would mean two native sinks in the browser, each posting the same event to
	// the same ingest path, doubling every pageview and conversion on a scoped install.
	it('serves one slot when the scope registry defaults to the global slot adapter', async () => {
		const config = await trackerConfig(booted)
		expect(config.slots.map((s) => [s.slot, s.adapterId])).toEqual([['global', 'native']])
	})
})

describeForDb('analytics capture slots - disabled with false', { dbs: ['mongo'] }, (db) => {
	const server = setupServer(http.all(`${INGEST}/*`, () => new HttpResponse('ok', { status: 200 })))
	let booted: BootedPayload

	beforeAll(async () => {
		server.listen({ onUnhandledRequest: 'error' })
		booted = await bootPayload({
			db,
			plugin: analytics({
				adapters: [vendorAdapter()],
				scopeResolver: alwaysScoped,
				capture: { slots: { global: false, tenant: 'vendor' } },
			}),
		})
	}, 240_000)

	afterAll(async () => {
		server.close()
		await booted.stop()
	})

	const proxy = (slot: string) =>
		handleEndpoints({
			config: booted.payload.config,
			payloadInstanceCacheKey: booted.cacheKey,
			request: new Request(`http://localhost:3000/api/analytics/p/${slot}/e`),
		})

	it('omits the disabled slot from the tracker config', async () => {
		const config = await trackerConfig(booted)
		expect(config.slots.map((s) => s.slot)).toEqual(['tenant'])
	})

	it('404s the disabled slot proxy mount while the filled one still forwards', async () => {
		expect((await proxy('global')).status).toBe(404)
		expect((await proxy('tenant')).status).toBe(200)
	})
})
