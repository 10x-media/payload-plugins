import type { PayloadRequest } from 'payload'
import { describe, expect, it, vi } from 'vitest'
import { ga4 } from '../adapters/ga4/ga4'
import { plausible } from '../adapters/plausible/plausible'
import { posthog } from '../adapters/posthog/posthog'
import { umami } from '../adapters/umami/umami'
import type { AnalyticsAdapter } from '../core/contract'
import { createRegistry } from '../core/registry'
import type { Goal } from '../goals/types'
import { native } from '../native/nativeAdapter'
import type { AnalyticsRuntime } from '../plugin/runtime'
import { resolveTrackerConfig } from './trackerConfig'

const posthogSlot = () =>
	posthog({ projectId: '1', apiKey: 'phx_private', projectToken: 'phc_public' })

const req = (overrides: Partial<PayloadRequest> = {}): PayloadRequest =>
	({
		payload: { config: { routes: { api: '/api' } }, logger: { warn: vi.fn() } },
		...overrides,
	}) as unknown as PayloadRequest

const runtimeWith = (
	adapters: AnalyticsAdapter[],
	partial: Partial<AnalyticsRuntime> = {}
): AnalyticsRuntime => ({
	registry: createRegistry(adapters),
	configAdapterIds: new Set(adapters.map((a) => a.id)),
	bindings: {},
	engine: {} as AnalyticsRuntime['engine'],
	ttl: {},
	comparison: true,
	...partial,
})

/** A runtime whose tenant slot resolves through a per-scope registry, like providers do. */
const scopedRuntime = (
	config: AnalyticsAdapter[],
	perScope: Record<string, AnalyticsAdapter[]>,
	partial: Partial<AnalyticsRuntime> = {}
): AnalyticsRuntime =>
	runtimeWith(config, {
		scoped: true,
		resolveScope: async (r) => r.headers?.get('x-tenant') ?? null,
		resolveRegistry: async ({ scope }) =>
			createRegistry([...(scope && perScope[scope] ? perScope[scope] : []), ...config]),
		...partial,
	})

const scopedReq = (tenant?: string): PayloadRequest =>
	req({ headers: new Headers(tenant ? { 'x-tenant': tenant } : {}) })

describe('resolveTrackerConfig slots', () => {
	it('serves the global native slot with no snippet scripts', async () => {
		const runtime = runtimeWith([native()])
		const config = await resolveTrackerConfig({ runtime, req: req() })
		expect(config.slots).toHaveLength(1)
		expect(config.slots[0]).toMatchObject({
			slot: 'global',
			kind: 'native',
			adapterId: 'native',
			path: '/api/analytics/p/global',
			requiresConsent: false,
		})
		expect(config.slots[0]?.snippet.scripts).toEqual([])
	})

	it('serves both slots when a scope fills the tenant one', async () => {
		const runtime = scopedRuntime(
			[native()],
			{ 'tenant-a': [posthogSlot()] },
			{
				captureSlots: { tenant: 'posthog' },
				platformAdapterId: 'native',
			}
		)
		const config = await resolveTrackerConfig({ runtime, req: scopedReq('tenant-a') })
		expect(config.slots.map((s) => [s.slot, s.adapterId, s.kind])).toEqual([
			['global', 'native', 'native'],
			['tenant', 'posthog', 'posthog'],
		])
		expect(config.slots[1]?.path).toBe('/api/analytics/p/tenant')
		expect(config.slots[1]?.requiresConsent).toBe(true)
		expect(config.slots[1]?.snippet.scripts[0]?.src).toBe('/api/analytics/p/tenant/static/array.js')
	})

	it('omits the tenant slot when no scope resolves', async () => {
		const runtime = scopedRuntime(
			[native()],
			{ 'tenant-a': [posthogSlot()] },
			{
				captureSlots: { tenant: 'posthog' },
				platformAdapterId: 'native',
			}
		)
		const config = await resolveTrackerConfig({ runtime, req: scopedReq() })
		expect(config.slots.map((s) => s.slot)).toEqual(['global'])
	})

	it('omits a slot whose adapter declares no capture support', async () => {
		const runtime = runtimeWith([
			ga4({ propertyId: '1', credentials: { client_email: 'a@b.test', private_key: 'k' } }),
		])
		const config = await resolveTrackerConfig({ runtime, req: req() })
		expect(config.slots).toEqual([])
	})

	it('omits a slot whose snippet throws rather than failing the whole config', async () => {
		const broken: AnalyticsAdapter = {
			...native(),
			id: 'broken',
			capture: {
				proxy: { routes: [] },
				snippet: () => {
					throw new Error('boom')
				},
				client: { kind: 'plausible' },
			},
		}
		const runtime = runtimeWith([broken])
		await expect(resolveTrackerConfig({ runtime, req: req() })).resolves.toMatchObject({
			slots: [],
		})
	})
})

describe('resolveTrackerConfig paths', () => {
	it("derives the proxy mount from the app's own routes.api", async () => {
		const runtime = runtimeWith([posthogSlot()])
		const config = await resolveTrackerConfig({
			runtime,
			req: req({
				payload: {
					config: { routes: { api: '/payload-api' } },
					logger: { warn: vi.fn() },
				},
			} as unknown as Partial<PayloadRequest>),
		})
		expect(config.slots[0]?.path).toBe('/payload-api/analytics/p/global')
		expect(config.ingestPath).toBe('/payload-api/analytics/ingest')
	})

	it('lets a capture.paths override replace the mount, for Next rewrites', async () => {
		const runtime = runtimeWith([posthogSlot()], { capturePaths: { global: '/ph' } })
		const config = await resolveTrackerConfig({ runtime, req: req() })
		expect(config.slots[0]?.path).toBe('/ph')
		expect(config.slots[0]?.snippet.scripts[0]?.src).toBe('/ph/static/array.js')
	})

	it('carries the native ingest path whether or not a native slot is filled', async () => {
		const runtime = runtimeWith([posthogSlot()])
		const config = await resolveTrackerConfig({ runtime, req: req() })
		expect(config.ingestPath).toBe('/api/analytics/ingest')
	})
})

describe('resolveTrackerConfig consent', () => {
	it('asks the runtime policy per slot', async () => {
		const consentFor = vi.fn(() => 'none' as const)
		const runtime = runtimeWith([posthogSlot()], { consentFor })
		const config = await resolveTrackerConfig({ runtime, req: req() })
		expect(consentFor).toHaveBeenCalledWith('global', 'posthog', 'posthog')
		expect(config.slots[0]?.requiresConsent).toBe(false)
	})

	it('defaults to native none / vendor required when the runtime carries no policy', async () => {
		const nativeOnly = await resolveTrackerConfig({
			runtime: runtimeWith([native()]),
			req: req(),
		})
		expect(nativeOnly.slots[0]?.requiresConsent).toBe(false)
		const vendorOnly = await resolveTrackerConfig({
			runtime: runtimeWith([posthogSlot()]),
			req: req(),
		})
		expect(vendorOnly.slots[0]?.requiresConsent).toBe(true)
	})
})

describe('resolveTrackerConfig autoCapture and goals', () => {
	const signup: Goal = { slug: 'signup', name: 'Signup', match: { kind: 'goal' } }

	it('defaults every auto-capture toggle on', async () => {
		const config = await resolveTrackerConfig({ runtime: runtimeWith([native()]), req: req() })
		expect(config.autoCapture).toEqual({
			scrollDepth: true,
			outboundLinks: true,
			fileDownloads: true,
			goalAttribute: true,
		})
	})

	it('carries the runtime auto-capture toggles through', async () => {
		const autoCapture = {
			scrollDepth: false,
			outboundLinks: true,
			fileDownloads: false,
			goalAttribute: true,
		}
		const config = await resolveTrackerConfig({
			runtime: runtimeWith([native()], { autoCapture }),
			req: req(),
		})
		expect(config.autoCapture).toEqual(autoCapture)
	})

	it('strips the admin-facing goal name, keeping what the tracker matches on', async () => {
		const config = await resolveTrackerConfig({
			runtime: runtimeWith([native()], {
				goals: [
					signup,
					{
						slug: 'purchase',
						name: 'Purchase',
						match: { kind: 'event', name: 'purchase' },
						value: { prop: 'total' },
						currency: 'EUR',
					},
				],
			}),
			req: req(),
		})
		expect(config.goals).toEqual([
			{ slug: 'signup', match: { kind: 'goal' } },
			{
				slug: 'purchase',
				match: { kind: 'event', name: 'purchase' },
				value: { prop: 'total' },
				currency: 'EUR',
			},
		])
		expect(JSON.stringify(config.goals)).not.toContain('Signup')
	})
})

describe('resolveTrackerConfig secrets', () => {
	it('never serializes a vendor credential into the browser-bound config', async () => {
		const adapters = [
			posthogSlot(),
			plausible({ siteId: 'site.test', apiKey: 'plausible_secret', domain: 'site.test' }),
			umami({ websiteId: 'w1', apiKey: 'umami_secret', token: 'umami_token' }),
		]
		for (const adapter of adapters) {
			const runtime = runtimeWith([adapter])
			const config = await resolveTrackerConfig({ runtime, req: req() })
			const json = JSON.stringify(config)
			expect(config.slots).toHaveLength(1)
			for (const secret of ['phx_private', 'plausible_secret', 'umami_secret', 'umami_token']) {
				expect(json).not.toContain(secret)
			}
		}
	})

	it('keeps the public browser token, which the snippet cannot boot without', async () => {
		const runtime = runtimeWith([posthogSlot()])
		const config = await resolveTrackerConfig({ runtime, req: req() })
		expect(JSON.stringify(config)).toContain('phc_public')
	})
})
