import { type BootedPayload, bootPayload, describeForDb } from '@10x-media/payload-test-harness'
import { handleEndpoints } from 'payload'
import { afterAll, beforeAll, expect, it } from 'vitest'
import { posthog } from '../../src/adapters/posthog/posthog'
import { publicDigest } from '../../src/capture/exclusionToken'
import { analytics } from '../../src/index'
import { native } from '../../src/native/nativeAdapter'
import { getTrackerConfig, NEXT_DRAFT_COOKIE } from '../../src/site/getTrackerConfig'
import { memoryAdapter } from '../../src/testing/memoryAdapter'
import type { TrackerConfig } from '../../src/tracker/config'

const SECRET = 'phx_private_query_key'

/** A capture-capable runtime provider; `vendor` is what `capture.slots.tenant` names. */
const captureVendor = () => ({
	...posthog({ projectId: '1', apiKey: SECRET, projectToken: 'phc_public' }),
	id: 'vendor',
	label: 'vendor',
})

/** Same slot id, no capture support at all: the slot must be absent, not broken. */
const plainVendor = () => ({ ...memoryAdapter(), id: 'vendor', label: 'vendor' })

/** Query credentials only: a dashboard-read provider declares no capture, so no slot. */
const readOnlyVendor = () => ({
	...posthog({ projectId: '1', apiKey: SECRET }),
	id: 'vendor',
	label: 'vendor',
})

describeForDb('analytics tracker endpoint', {}, (db) => {
	let booted: BootedPayload

	beforeAll(async () => {
		booted = await bootPayload({
			db,
			plugin: analytics({
				adapters: [native({ ingestPath: '/analytics/collect' })],
				scope: {
					member: () => true,
					resolve: ({ req }) => {
						const host = req.host?.split(':')[0] ?? null
						if (host === 'boom.test') {
							throw new Error('scope resolution exploded')
						}
						return host?.endsWith('.test') ? host : null
					},
				},
				providers: {
					resolve: ({ scope }) =>
						scope === 'site-a.test'
							? [captureVendor()]
							: scope === 'site-b.test'
								? [plainVendor()]
								: scope === 'site-c.test'
									? [readOnlyVendor()]
									: [],
				},
				capture: { gate: ({ kind }) => kind !== 'native', slots: { tenant: 'vendor' } },
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
			request: new Request(`${origin}/api/_x/config`),
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
		expect(config.slots[0]?.gated).toBe(false)
		expect(config.ingestPath).toBe('/api/analytics/collect')
		// No collection is bound as items here, so no page watches for them.
		expect(config.autoCapture).toEqual({
			scrollDepth: false,
			outboundLinks: true,
			fileDownloads: true,
			goalAttribute: true,
			query: true,
			items: { impressions: false, clicks: false, pages: false },
		})
		expect(config.admin).toEqual({ path: publicDigest('/admin') })
		expect(config).not.toHaveProperty('skip')
		expect(config).not.toHaveProperty('draft')
	})

	// A preview booted by `initTracker` is left uncounted like a rendered one, and the cookie
	// that says so is read before the request reaches any resolver without its cookies.
	it("says draft for a request carrying Next's draft mode cookie", async () => {
		const res = await handleEndpoints({
			config: booted.payload.config,
			payloadInstanceCacheKey: booted.cacheKey,
			request: new Request('http://site-a.test/api/_x/config', {
				headers: { cookie: `theme=dark; ${NEXT_DRAFT_COOKIE}=preview-id` },
			}),
		})
		const config = (await res.json()) as TrackerConfig
		expect(config.draft).toBe(true)
		expect(config.slots.map((s) => s.slot)).toEqual(['global', 'tenant'])
	})

	it('names no admin address in the public response', async () => {
		const text = await (await request()).text()
		expect(text).not.toContain('"/admin')
		expect(text).not.toContain('localhost:3000/admin')
	})

	it('carries the config goals without their admin-facing names', async () => {
		const config = await body()
		expect(config.goals).toEqual([{ slug: 'signup', match: { kind: 'goal' } }])
	})

	it('caches per host and cookie, and sets no cookie', async () => {
		const res = await request()
		expect(res.headers.get('cache-control')).toBe('private, max-age=60')
		// No cookie reaches the resolver at a capture call site; the draft mode cookie alone
		// changes the body, and it is read before the cookies are stripped.
		expect(res.headers.get('vary')).toBe('Host, Cookie')
		expect(res.headers.getSetCookie()).toEqual([])
		expect(res.headers.get('set-cookie')).toBeNull()
	})

	it("fills the tenant slot from the scope's own capture-capable provider", async () => {
		const config = await body('http://site-a.test')
		const tenant = config.slots.find((s) => s.slot === 'tenant')
		expect(tenant).toMatchObject({
			adapterId: 'vendor',
			kind: 'posthog',
			path: '/api/_x/p/tenant',
			gated: true,
		})
		expect(tenant?.snippet.scripts[0]?.inline).toContain('api_host:"/api/_x/p/tenant"')
	})

	it("omits the tenant slot when the scope's adapter declares no capture", async () => {
		const config = await body('http://site-b.test')
		expect(config.slots.map((s) => s.slot)).toEqual(['global'])
	})

	it('omits the tenant slot for a PostHog provider that has no public projectToken', async () => {
		const config = await body('http://site-c.test')
		expect(config.slots.map((s) => s.slot)).toEqual(['global'])
	})

	it('omits the tenant slot when no scope resolves', async () => {
		const config = await body('http://unknown.example')
		expect(config.slots.map((s) => s.slot)).toEqual(['global'])
	})

	// The tracker endpoint and the capture proxy are the first unauthenticated callers of
	// the host's scope.resolve: a throwing resolver must fail closed, never 500.
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

describeForDb('analytics tracker endpoint with query capture off', {}, (db) => {
	let booted: BootedPayload

	beforeAll(async () => {
		booted = await bootPayload({
			db,
			plugin: analytics({
				adapters: [native()],
				capture: { gate: 'off', autoCapture: { query: false } },
			}),
		})
	}, 240_000)

	afterAll(async () => {
		await booted.stop()
	})

	// The tracker sends the query string unless this key arrives as exactly `false`, so an opt-out
	// that never reached the public config would silently keep sending it.
	it('carries the disabled toggle into the public tracker config', async () => {
		const res = await handleEndpoints({
			config: booted.payload.config,
			payloadInstanceCacheKey: booted.cacheKey,
			request: new Request('http://localhost:3000/api/_x/config'),
		})
		expect(res.status).toBe(200)
		const config = (await res.json()) as TrackerConfig
		expect(config.autoCapture.query).toBe(false)
		expect(config.autoCapture.outboundLinks).toBe(true)
	})
})
