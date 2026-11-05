import type { PayloadRequest } from 'payload'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ga4 } from '../adapters/ga4/ga4'
import { plausible } from '../adapters/plausible/plausible'
import { posthog } from '../adapters/posthog/posthog'
import { umami } from '../adapters/umami/umami'
import type { AnalyticsAdapter } from '../core/contract'
import type { CaptureGatePolicy } from '../core/options'
import { createRegistry } from '../core/registry'
import type { Goal } from '../goals/types'
import { native } from '../native/nativeAdapter'
import type { AnalyticsRuntime } from '../plugin/runtime'
import { exclusionPrelude } from './exclusionPrelude'
import { exclusionToken, exclusionTokenHash, publicDigest } from './exclusionToken'
import { resolveTrackerConfig } from './trackerConfig'

const posthogSlot = () =>
	posthog({ projectId: '1', apiKey: 'phx_private', projectToken: 'phc_public' })

const req = (overrides: Record<string, unknown> = {}): PayloadRequest =>
	({
		payload: { config: { routes: { api: '/api' } }, logger: { warn: vi.fn() } },
		...overrides,
	}) as unknown as PayloadRequest

/** Holds every vendor slot and opens native, so a slot's `gated` tells the two kinds apart. */
const vendorsWait: CaptureGatePolicy = ({ kind }) => kind !== 'native'

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
	captureGate: vendorsWait,
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
		resolveRegistry: async ({ scope }) => ({
			registry: createRegistry([...(scope && perScope[scope] ? perScope[scope] : []), ...config]),
			grants: new Map(),
		}),
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
			path: '/api/_x/p/global',
			gated: false,
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
		expect(config.slots[1]?.path).toBe('/api/_x/p/tenant')
		expect(config.slots[1]?.gated).toBe(true)
		expect(config.slots[1]?.snippet.scripts[0]?.inline).toContain('api_host:"/api/_x/p/tenant"')
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

	// Two entries for one adapter means two sinks posting the same event twice. Global
	// iterates first, so it is the entry that survives.
	it('emits one slot when both resolve to the same adapter', async () => {
		const runtime = scopedRuntime([native()], {}, { captureSlots: { global: 'native' } })
		const config = await resolveTrackerConfig({ runtime, req: scopedReq('tenant-a') })
		expect(config.slots.map((s) => [s.slot, s.adapterId])).toEqual([['global', 'native']])
	})

	// posthog-js runs a named client beside the primary one, each with its own project and opt-out.
	it('keeps a second PostHog slot as the named client "tenant"', async () => {
		const tenantPosthog: AnalyticsAdapter = {
			...posthog({
				projectId: '2',
				apiKey: 'phx_tenant',
				projectToken: 'phc_tenant',
				scopeProperty: 'site',
			}),
			id: 'posthog:tenant-doc',
		}
		const runtime = scopedRuntime(
			[posthogSlot()],
			{ 'tenant-a': [tenantPosthog] },
			{ platformAdapterId: 'posthog' }
		)
		const warn = vi.fn()
		const config = await resolveTrackerConfig({
			runtime,
			req: req({
				payload: { config: { routes: { api: '/api' } }, logger: { warn } },
				headers: new Headers({ 'x-tenant': 'tenant-a' }),
			}),
		})

		expect(config.slots.map((s) => [s.slot, s.adapterId, s.instance])).toEqual([
			['global', 'posthog', undefined],
			['tenant', 'posthog:tenant-doc', 'tenant'],
		])
		const [global, tenant] = config.slots.map((s) => s.snippet.scripts.at(-1)?.inline ?? '')
		expect(global).toContain('posthog.init("phc_public",{')
		expect(global).toContain('capture_pageview:"history_change"')
		expect(global).not.toContain('"tenant"')
		expect(tenant).toContain('posthog.init("phc_tenant",{api_host:"/api/_x/p/tenant"')
		expect(tenant).toContain('capture_pageview:false,capture_pageleave:true')
		expect(tenant).toContain('},"tenant")')
		// A slot counting without consent stamps its scope on every event: a mode switch drops `register`.
		expect(tenant).toContain(
			'before_send:function(e){e&&e.properties&&(e.properties["site"]="tenant-a")'
		)
		expect(config.slots.every((s) => s.gated)).toBe(true)
		expect(warn).not.toHaveBeenCalled()
	})

	it('leaves a PostHog slot the global slot does not share on the primary client', async () => {
		const runtime = scopedRuntime(
			[native()],
			{ 'tenant-a': [posthogSlot()] },
			{ captureSlots: { tenant: 'posthog' }, platformAdapterId: 'native' }
		)
		const config = await resolveTrackerConfig({ runtime, req: scopedReq('tenant-a') })
		const tenant = config.slots.find((s) => s.slot === 'tenant')
		expect(tenant).not.toHaveProperty('instance')
		expect(tenant?.snippet.scripts[0]?.inline).toContain(
			'posthog.init("phc_public",{api_host:"/api/_x/p/tenant",ui_host:"https://us.posthog.com",capture_pageview:"history_change",opt_out_persistence_by_default:true,cookieless_mode:"on_reject",opt_out_capturing_by_default:true})'
		)
	})

	// Every other vendor runs one global per page: the tenant's init would land on the platform's.
	it('leaves out a second slot of another vendor kind, warning once', async () => {
		const site = (domain: string) => plausible({ siteId: domain, apiKey: 'k', domain })
		const runtime = scopedRuntime(
			[site('platform.test')],
			{ 'tenant-a': [{ ...site('a.test'), id: 'tenant-plausible' }] },
			{ captureSlots: { global: 'plausible', tenant: 'tenant-plausible' } }
		)
		const warn = vi.fn()
		const payload = { config: { routes: { api: '/api' } }, logger: { warn } }
		const visit = () =>
			resolveTrackerConfig({
				runtime,
				req: req({
					payload,
					headers: new Headers({ 'x-tenant': 'tenant-a' }),
				}),
			})

		const config = await visit()
		await visit()

		expect(config.slots.map((s) => [s.slot, s.adapterId])).toEqual([['global', 'plausible']])
		expect(warn).toHaveBeenCalledTimes(1)
		expect(warn.mock.calls[0]?.[0]).toContain(
			'the tenant slot resolved to "tenant-plausible", a second plausible slot beside "plausible" on the global slot'
		)
		expect(warn.mock.calls[0]?.[0]).toContain('only PostHog runs a second client')
	})

	it('keeps two slots of different vendor kinds', async () => {
		const runtime = scopedRuntime(
			[posthogSlot()],
			{ 'tenant-a': [plausible({ siteId: 'a.test', apiKey: 'k', domain: 'a.test' })] },
			{ captureSlots: { global: 'posthog', tenant: 'plausible' } }
		)
		const config = await resolveTrackerConfig({ runtime, req: scopedReq('tenant-a') })
		expect(config.slots.map((s) => s.kind)).toEqual(['posthog', 'plausible'])
	})

	it('omits a slot disabled with false', async () => {
		const runtime = scopedRuntime(
			[native()],
			{ 'tenant-a': [posthogSlot()] },
			{ captureSlots: { global: false, tenant: 'posthog' }, platformAdapterId: 'native' }
		)
		const config = await resolveTrackerConfig({ runtime, req: scopedReq('tenant-a') })
		expect(config.slots.map((s) => s.slot)).toEqual(['tenant'])
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
			}),
		})
		expect(config.slots[0]?.path).toBe('/payload-api/_x/p/global')
		expect(config.ingestPath).toBe('/payload-api/_x/e')
	})

	it('lets a capture.paths override replace the mount, for a captureRoute handler', async () => {
		const runtime = runtimeWith([posthogSlot()], { capturePaths: { global: '/ph' } })
		const config = await resolveTrackerConfig({ runtime, req: req() })
		expect(config.slots[0]?.path).toBe('/ph')
		expect(config.slots[0]?.snippet.scripts[0]?.inline).toContain('api_host:"/ph"')
	})

	it('normalizes an override the way captureRoute mounts it', async () => {
		for (const override of ['/ph/', 'ph', 'ph//']) {
			const runtime = runtimeWith([posthogSlot()], { capturePaths: { global: override } })
			const config = await resolveTrackerConfig({ runtime, req: req() })
			expect(config.slots[0]?.path).toBe('/ph')
		}
	})

	it('carries the native ingest path whether or not a native slot is filled', async () => {
		const runtime = runtimeWith([posthogSlot()])
		const config = await resolveTrackerConfig({ runtime, req: req() })
		expect(config.ingestPath).toBe('/api/_x/e')
	})

	it("follows the native adapter's own ingest mount when it moved", async () => {
		const runtime = runtimeWith([native({ ingestPath: '/custom/ingest' })], {
			ingestPath: '/custom/ingest',
		})
		const config = await resolveTrackerConfig({ runtime, req: req() })
		expect(config.ingestPath).toBe('/api/custom/ingest')
	})
})

describe('resolveTrackerConfig behind a Next basePath', () => {
	afterEach(() => {
		vi.unstubAllEnvs()
	})

	it('puts the base path in front of the proxy mount, the ingest path and the snippet', async () => {
		vi.stubEnv('NEXT_BASE_PATH', '/docs')
		const config = await resolveTrackerConfig({ runtime: runtimeWith([posthogSlot()]), req: req() })
		expect(config.slots[0]?.path).toBe('/docs/api/_x/p/global')
		expect(config.slots[0]?.snippet.scripts[0]?.inline).toContain(
			'api_host:"/docs/api/_x/p/global"'
		)
		expect(config.ingestPath).toBe('/docs/api/_x/e')
	})

	it('serves a capture.paths override under the base path too, where Next serves the route handler', async () => {
		vi.stubEnv('NEXT_BASE_PATH', '/docs')
		const runtime = runtimeWith([posthogSlot()], { capturePaths: { global: '/ph' } })
		const config = await resolveTrackerConfig({ runtime, req: req() })
		expect(config.slots[0]?.path).toBe('/docs/ph')
	})

	it('stays relative whatever serverURL says', async () => {
		const config = await resolveTrackerConfig({
			runtime: runtimeWith([posthogSlot()]),
			req: req({
				payload: {
					config: { routes: { api: '/api' }, serverURL: 'https://cms.example.com' },
					logger: { warn: vi.fn() },
				},
			}),
		})
		expect(config.slots[0]?.path).toBe('/api/_x/p/global')
		expect(config.ingestPath).toBe('/api/_x/e')
	})
})

describe('resolveTrackerConfig gate', () => {
	it('asks capture.gate per slot, with the adapter filling it', async () => {
		const captureGate = vi.fn<CaptureGatePolicy>(() => false)
		const runtime = runtimeWith([posthogSlot()], { captureGate })
		const config = await resolveTrackerConfig({ runtime, req: req() })
		expect(captureGate).toHaveBeenCalledWith({
			slot: 'global',
			adapterId: 'posthog',
			kind: 'posthog',
		})
		expect(config.slots[0]?.gated).toBe(false)
	})

	it('holds every slot when the runtime carries no gate', async () => {
		const config = await resolveTrackerConfig({
			runtime: runtimeWith([native()], { captureGate: undefined }),
			req: req(),
		})
		expect(config.slots[0]?.gated).toBe(true)
	})

	it('holds the slot and warns when the gate throws', async () => {
		const warn = vi.fn()
		const runtime = runtimeWith([native()], {
			captureGate: () => {
				throw new Error('consent manager offline')
			},
		})
		const config = await resolveTrackerConfig({
			runtime,
			req: req({
				payload: { config: { routes: { api: '/api' } }, logger: { warn } },
			}),
		})
		expect(config.slots[0]?.gated).toBe(true)
		expect(warn).toHaveBeenCalledWith(expect.stringContaining('capture.gate'))
	})
})

describe('resolveTrackerConfig without consent', () => {
	const holdAll: CaptureGatePolicy = () => true
	const ga4Slot = (withoutConsent?: 'cookieless' | 'off') =>
		ga4({
			propertyId: '1',
			credentials: { client_email: 'a@b.c', private_key: 'k' },
			measurementId: 'G-AB12CD34',
			...(withoutConsent ? { withoutConsent } : {}),
		})

	/** The adapter with its snippet recording the arguments the config renders it with. */
	const recording = (adapter: AnalyticsAdapter) => {
		const capture = adapter.capture
		if (!capture) {
			throw new Error('no capture')
		}
		const snippet = vi.fn(capture.snippet)
		return { adapter: { ...adapter, capture: { ...capture, snippet } }, snippet }
	}

	it('counts a held slot cookielessly in both phases while the option is unset', async () => {
		const { adapter, snippet } = recording(posthogSlot())
		const config = await resolveTrackerConfig({
			runtime: runtimeWith([adapter], { captureGate: holdAll }),
			req: req(),
		})
		expect(config.slots[0]).toMatchObject({
			gated: true,
			withoutConsent: { pending: 'cookieless', refused: 'cookieless' },
		})
		expect(snippet).toHaveBeenCalledWith(
			expect.objectContaining({ mode: 'cookieless', withoutConsent: true })
		)
	})

	it("serves 1.0.0-beta.14's config for 'off': no level, the same snippet", async () => {
		const { adapter, snippet } = recording(posthogSlot())
		const config = await resolveTrackerConfig({
			runtime: runtimeWith([adapter], {
				captureGate: holdAll,
				captureWithoutConsent: { pending: 'off', refused: 'off' },
			}),
			req: req(),
		})
		const slot = config.slots[0]
		expect(slot?.gated).toBe(true)
		expect(slot && 'withoutConsent' in slot).toBe(false)
		expect(snippet).toHaveBeenCalledWith(
			expect.objectContaining({ mode: 'full', withoutConsent: false })
		)
		expect(slot?.snippet).toEqual(
			posthogSlot().capture?.snippet({ path: '/api/_x/p/global', scope: null })
		)
	})

	it('runs a slot the gate does not hold in full, whatever the option says', async () => {
		const { adapter, snippet } = recording(posthogSlot())
		const config = await resolveTrackerConfig({
			runtime: runtimeWith([adapter], {
				captureGate: () => false,
				captureWithoutConsent: () => 'cookieless',
			}),
			req: req(),
		})
		expect(config.slots[0]?.gated).toBe(false)
		expect(config.slots[0]?.withoutConsent).toBeUndefined()
		expect(snippet).toHaveBeenCalledWith(expect.objectContaining({ mode: 'full' }))
	})

	it('keeps GA4 strict unless its own option or a function opts it in', async () => {
		const levels = async (adapter: AnalyticsAdapter, partial: Partial<AnalyticsRuntime> = {}) =>
			(
				await resolveTrackerConfig({
					runtime: runtimeWith([adapter], { captureGate: holdAll, ...partial }),
					req: req(),
				})
			).slots[0]?.withoutConsent
		expect(await levels(ga4Slot())).toBeUndefined()
		expect(await levels(ga4Slot('cookieless'))).toEqual({
			pending: 'cookieless',
			refused: 'cookieless',
		})
		expect(
			await levels(ga4Slot(), {
				captureWithoutConsent: ({ phase }) => (phase === 'pending' ? 'cookieless' : 'off'),
			})
		).toEqual({ pending: 'cookieless', refused: 'off' })
		expect(
			await levels(ga4Slot('off'), { captureWithoutConsent: () => 'cookieless' })
		).toBeUndefined()
	})

	it('holds a slot whose function throws to nothing, warning once per instance', async () => {
		const warn = vi.fn()
		const payload = { config: { routes: { api: '/api' } }, logger: { warn } }
		const runtime = runtimeWith([native()], {
			captureGate: holdAll,
			captureWithoutConsent: () => {
				throw new Error('policy offline')
			},
		})
		for (let visit = 0; visit < 2; visit++) {
			const config = await resolveTrackerConfig({ runtime, req: req({ payload }) })
			expect(config.slots[0]?.withoutConsent).toBeUndefined()
		}
		expect(warn).toHaveBeenCalledTimes(1)
		expect(warn).toHaveBeenCalledWith(
			expect.stringMatching(/capture\.withoutConsent.*policy offline/)
		)
	})
})

describe('resolveTrackerConfig autoCapture and goals', () => {
	const signup: Goal = { slug: 'signup', name: 'Signup', match: { kind: 'goal' } }

	it('defaults every auto-capture toggle on but scroll depth', async () => {
		const config = await resolveTrackerConfig({ runtime: runtimeWith([native()]), req: req() })
		expect(config.autoCapture).toEqual({
			scrollDepth: false,
			outboundLinks: true,
			fileDownloads: true,
			goalAttribute: true,
			query: true,
			items: { impressions: true, clicks: true, pages: true },
		})
	})

	it('carries the runtime auto-capture toggles through', async () => {
		const autoCapture = {
			scrollDepth: false,
			outboundLinks: true,
			fileDownloads: false,
			goalAttribute: true,
			query: false,
			items: { impressions: false, clicks: true, pages: false },
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

	it('serves the goals merged for the request, not the config snapshot', async () => {
		const runtime = runtimeWith([native()], {
			goals: [signup],
			resolveGoals: async () => [
				signup,
				{ slug: 'newsletter', name: 'Newsletter', match: { kind: 'event', name: 'subscribed' } },
			],
		})
		const config = await resolveTrackerConfig({ runtime, req: req() })
		expect(config.goals).toEqual([
			{ slug: 'signup', match: { kind: 'goal' } },
			{ slug: 'newsletter', match: { kind: 'event', name: 'subscribed' } },
		])
	})

	it("carries a collection goal's value where it overrides the config goal's slug", async () => {
		const runtime = runtimeWith([native()], {
			goals: [signup],
			resolveGoals: async () => [
				{ ...signup, name: 'Signup (edited)', value: { fixed: 42 }, currency: 'EUR' },
			],
		})
		const config = await resolveTrackerConfig({ runtime, req: req() })
		expect(config.goals).toEqual([
			{ slug: 'signup', match: { kind: 'goal' }, value: { fixed: 42 }, currency: 'EUR' },
		])
		expect(JSON.stringify(config.goals)).not.toContain('edited')
	})

	it('falls back to the config goals when the resolver fails', async () => {
		const warn = vi.fn()
		const runtime = runtimeWith([native()], {
			goals: [signup],
			resolveGoals: async () => {
				throw new Error('goals are down')
			},
		})
		const config = await resolveTrackerConfig({
			runtime,
			req: req({
				payload: { config: { routes: { api: '/api' } }, logger: { warn } },
			}),
		})
		expect(config.goals).toEqual([{ slug: 'signup', match: { kind: 'goal' } }])
		expect(warn).toHaveBeenCalledTimes(1)
	})

	it('resolves the scope once and hands the same one to the goals and the tenant slot', async () => {
		const resolveScope = vi.fn(async () => 'tenant-a')
		const seen: Array<string | null | undefined> = []
		const runtime = scopedRuntime(
			[native()],
			{ 'tenant-a': [posthogSlot()] },
			{
				captureSlots: { tenant: 'posthog' },
				platformAdapterId: 'native',
				resolveScope,
				resolveGoals: async (_req, scope) => {
					seen.push(scope)
					return [signup]
				},
			}
		)
		const config = await resolveTrackerConfig({ runtime, req: scopedReq('tenant-a') })
		expect(resolveScope).toHaveBeenCalledTimes(1)
		expect(seen).toEqual(['tenant-a'])
		expect(config.slots.map((s) => s.slot)).toEqual(['global', 'tenant'])
	})

	it('degrades a throwing scope resolver to an unscoped config', async () => {
		const warn = vi.fn()
		const runtime = runtimeWith([native()], {
			scoped: true,
			resolveScope: async () => {
				throw new Error('scope exploded')
			},
			goals: [signup],
			resolveGoals: async (_req, scope) => (scope === null ? [signup] : []),
		})
		const config = await resolveTrackerConfig({
			runtime,
			req: req({
				payload: { config: { routes: { api: '/api' } }, logger: { warn } },
			}),
		})
		expect(config.goals).toEqual([{ slug: 'signup', match: { kind: 'goal' } }])
		expect(config.slots.map((s) => s.slot)).toEqual(['global'])
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

describe('resolveTrackerConfig exclusion', () => {
	const SECRET = 'payload-secret'
	const signed = (overrides: Partial<PayloadRequest> = {}): PayloadRequest =>
		({
			payload: { config: { routes: { api: '/api' } }, logger: { warn: vi.fn() }, secret: SECRET },
			...overrides,
		}) as unknown as PayloadRequest

	it('carries no exclusion while the link is off', async () => {
		const config = await resolveTrackerConfig({ runtime: runtimeWith([native()]), req: signed() })
		expect(config.exclusion).toBeUndefined()
	})

	it("carries the parameter and the hash of the visit's own scope token, never the token", async () => {
		const runtime = scopedRuntime([native()], {}, { exclusion: { param: 'staff' } })
		const config = await resolveTrackerConfig({
			runtime,
			req: signed({ headers: new Headers({ 'x-tenant': 'tenant-a' }) }),
		})
		const token = exclusionToken(SECRET, 'tenant-a')
		expect(config.exclusion).toEqual({ param: 'staff', tokenHash: exclusionTokenHash(token) })
		expect(JSON.stringify(config)).not.toContain(token)
	})

	it('signs the install-wide scope for a visit that resolves none', async () => {
		const runtime = runtimeWith([native()], { exclusion: { param: 'analytics_exclude' } })
		const config = await resolveTrackerConfig({ runtime, req: signed() })
		expect(config.exclusion?.tokenHash).toBe(exclusionTokenHash(exclusionToken(SECRET, null)))
	})

	// GA4 reads page_location at `gtag('config')`; the others read the address as they load.
	it('leads every vendor snippet with the script that takes the parameter out, and no other', async () => {
		const vendors: AnalyticsAdapter[] = [
			ga4({
				propertyId: '1',
				credentials: { client_email: 'sa@x.iam', private_key: 'pk' },
				measurementId: 'G-AB12CD34',
			}),
			plausible({ siteId: 'example.com', apiKey: 'k', domain: 'example.com' }),
			umami({ websiteId: 'w', apiKey: 'k', host: 'https://umami.example.com' }),
			posthogSlot(),
		]
		for (const vendor of vendors) {
			const on = await resolveTrackerConfig({
				runtime: runtimeWith([vendor], { exclusion: { param: 'staff' } }),
				req: signed(),
			})
			const off = await resolveTrackerConfig({ runtime: runtimeWith([vendor]), req: signed() })
			const [first, ...rest] = on.slots[0]?.snippet.scripts ?? []
			expect(first).toEqual({ inline: exclusionPrelude('staff') })
			expect(rest).toEqual(off.slots[0]?.snippet.scripts)
			expect(JSON.stringify(off.slots[0]?.snippet)).not.toContain('history.replaceState')
		}
		const nativeOnly = await resolveTrackerConfig({
			runtime: runtimeWith([native()], { exclusion: { param: 'staff' } }),
			req: signed(),
		})
		expect(nativeOnly.slots[0]?.snippet.scripts).toEqual([])
	})
})

describe('resolveTrackerConfig skip', () => {
	it("names the admin while previews are skipped, and the install's choice only when it differs", async () => {
		const runtime = runtimeWith([native()])
		const config = await resolveTrackerConfig({ runtime, req: req() })
		expect(config).toMatchObject({ admin: { path: publicDigest('/admin') } })
		expect(config.admin).not.toHaveProperty('origin')
		expect(config).not.toHaveProperty('skip')
		expect(config).not.toHaveProperty('draft')

		const counted = await resolveTrackerConfig({
			runtime: runtimeWith([native()], { captureSkip: { automation: false, previews: false } }),
			req: req(),
			draft: true,
		})
		expect(counted).toMatchObject({ skip: { automation: false, previews: false }, draft: true })
		expect(counted).not.toHaveProperty('admin')
	})

	// The live preview is told by the admin's address, which no page should publish: a CMS on a
	// host of its own, or behind a route nobody guesses.
	it('names the admin on its own origin when serverURL is set, as digests alone', async () => {
		const config = await resolveTrackerConfig({
			runtime: runtimeWith([native()]),
			req: req({
				payload: {
					config: {
						routes: { api: '/api', admin: '/cms/' },
						serverURL: 'https://cms.example',
					},
					logger: { warn: vi.fn() },
				},
			}),
		})
		expect(config.admin).toEqual({
			origin: publicDigest('https://cms.example'),
			path: publicDigest('/cms'),
		})
		expect(JSON.stringify(config)).not.toContain('cms.example')
		expect(JSON.stringify(config)).not.toContain('"/cms')
	})

	it('digests an admin served at the root as /', async () => {
		const config = await resolveTrackerConfig({
			runtime: runtimeWith([native()]),
			req: req({
				payload: { config: { routes: { api: '/api', admin: '/' } }, logger: { warn: vi.fn() } },
			}),
		})
		expect(config.admin).toEqual({ path: publicDigest('/') })
	})
})
