import { type BootedPayload, bootPayload, describeForDb } from '@10x-media/payload-test-harness'
import { handleEndpoints } from 'payload'
import { afterAll, beforeAll, expect, it } from 'vitest'
import { posthog } from '../../src/adapters/posthog/posthog'
import { getTrackerConfig } from '../../src/capture/getTrackerConfig'
import type { TrackerConfig } from '../../src/capture/trackerConfig'
import { analytics } from '../../src/index'
import { native } from '../../src/native/nativeAdapter'
import { memoryAdapter } from '../../src/testing/memoryAdapter'

const SECRET = 'phx_private_query_key'

/** A capture-capable runtime provider; `vendor` is what `capture.slots.tenant` names. */
const captureVendor = () => ({
	...posthog({ projectId: '1', apiKey: SECRET, projectToken: 'phc_public' }),
	id: 'vendor',
	label: 'vendor',
})

/** Same slot id, no capture support at all: the slot must be absent, not broken. */
const plainVendor = () => ({ ...memoryAdapter(), id: 'vendor', label: 'vendor' })

describeForDb('analytics tracker endpoint', { dbs: ['mongo'] }, (db) => {
	let booted: BootedPayload

	beforeAll(async () => {
		booted = await bootPayload({
			db,
			plugin: analytics({
				adapters: [native({ ingestPath: '/analytics/collect' })],
				scopeResolver: ({ req }) => {
					const host = req.host?.split(':')[0] ?? null
					if (host === 'boom.test') {
						throw new Error('scope resolution exploded')
					}
					return host?.endsWith('.test') ? host : null
				},
				providers: {
					resolve: ({ scope }) =>
						scope === 'site-a.test'
							? [captureVendor()]
							: scope === 'site-b.test'
								? [plainVendor()]
								: [],
				},
				capture: { slots: { tenant: 'vendor' } },
				goals: [{ slug: 'signup', name: 'Signup', match: { kind: 'goal' } }],
			}),
		})
	}, 240_000)

	afterAll(async () => {
		await booted.stop()
	})

	const request = (origin = 'http://localhost:3000') =>
		handleEndpoints({
			config: booted.payload.config,
			payloadInstanceCacheKey: booted.cacheKey,
			request: new Request(`${origin}/api/analytics/tracker`),
		})

	const body = async (origin?: string): Promise<TrackerConfig> => {
		const res = await request(origin)
		expect(res.status).toBe(200)
		return (await res.json()) as TrackerConfig
	}

	// The ingest mount is moved deliberately: the config must follow the native adapter's
	// own endpoint rather than restating the default path.
	it('answers an anonymous request with the global slot and the ingest path', async () => {
		const config = await body()
		expect(config.slots.map((s) => [s.slot, s.adapterId, s.kind])).toEqual([
			['global', 'native', 'native'],
		])
		expect(config.slots[0]?.requiresConsent).toBe(false)
		expect(config.ingestPath).toBe('/api/analytics/collect')
		expect(config.autoCapture).toEqual({
			scrollDepth: false,
			outboundLinks: true,
			fileDownloads: true,
			goalAttribute: true,
		})
	})

	it('carries the config goals without their admin-facing names', async () => {
		const config = await body()
		expect(config.goals).toEqual([{ slug: 'signup', match: { kind: 'goal' } }])
	})

	it('caches per host and sets no cookie', async () => {
		const res = await request()
		expect(res.headers.get('cache-control')).toBe('private, max-age=60')
		expect(res.headers.get('vary')).toBe('Host')
		expect(res.headers.getSetCookie()).toEqual([])
		expect(res.headers.get('set-cookie')).toBeNull()
	})

	it("fills the tenant slot from the scope's own capture-capable provider", async () => {
		const config = await body('http://site-a.test')
		const tenant = config.slots.find((s) => s.slot === 'tenant')
		expect(tenant).toMatchObject({
			adapterId: 'vendor',
			kind: 'posthog',
			path: '/api/analytics/p/tenant',
			requiresConsent: true,
		})
		expect(tenant?.snippet.scripts[0]?.inline).toContain('api_host:"/api/analytics/p/tenant"')
	})

	it("omits the tenant slot when the scope's adapter declares no capture", async () => {
		const config = await body('http://site-b.test')
		expect(config.slots.map((s) => s.slot)).toEqual(['global'])
	})

	it('omits the tenant slot when no scope resolves', async () => {
		const config = await body('http://unknown.example')
		expect(config.slots.map((s) => s.slot)).toEqual(['global'])
	})

	// The tracker endpoint and the capture proxy are the first unauthenticated callers of
	// the host's scopeResolver: a throwing resolver must fail closed, never 500.
	it('answers 200 without the tenant slot when the scope resolver throws', async () => {
		const res = await request('http://boom.test')
		expect(res.status).toBe(200)
		const config = (await res.json()) as TrackerConfig
		expect(config.slots.map((s) => s.slot)).toEqual(['global'])
	})

	it('never serializes the provider credential into the public response', async () => {
		const res = await request('http://site-a.test')
		const text = await res.text()
		expect(text).not.toContain(SECRET)
		expect(text).toContain('phc_public')
	})

	it('resolves the same config server-side, with the passed headers deciding the scope', async () => {
		const scoped = await getTrackerConfig(booted.payload, {
			headers: new Headers({ host: 'site-a.test' }),
		})
		expect(scoped.slots.map((s) => s.slot)).toEqual(['global', 'tenant'])
		const unscoped = await getTrackerConfig(booted.payload)
		expect(unscoped.slots.map((s) => s.slot)).toEqual(['global'])
	})
})
