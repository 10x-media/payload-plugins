import { beforeEach, describe, expect, it } from 'vitest'
import { plausible } from '../adapters/plausible/plausible'
import { posthog } from '../adapters/posthog/posthog'
import type { CaptureSnippet } from '../core/capture'
import { createScriptLoader } from './loadScript'
import { createPlausibleSink } from './sinks/plausible'
import { createPosthogSink } from './sinks/posthog'
import type { TrackerWindow } from './types'

/**
 * The seam between an adapter's snippet and its sink: a sink only dispatches once the
 * vendor global exists, so a snippet whose inline init runs before its loader lands would
 * throw and never publish one. Running the snippets for real in a DOM is the only way to
 * catch that.
 */

interface VendorRealm {
	posthog?: unknown[] & { capture?: (name: string, props?: unknown) => void; _i?: unknown[] }
	plausible?: ((name: string, options?: unknown) => void) & {
		q?: unknown[]
		o?: { endpoint?: string }
		init?: (options?: unknown) => void
	}
}

/**
 * Scripts run in jsdom's own realm, whose `window` is not the object this test file sees,
 * so the snippet hands its realm out through the shared document.
 */
const scriptRealm = (): VendorRealm => {
	const bridge = document.createElement('script')
	bridge.text = 'document.__realm = window'
	document.head.appendChild(bridge)
	return (document as unknown as { __realm: VendorRealm }).__realm
}

const runSnippet = async (snippet: CaptureSnippet) => {
	const load = createScriptLoader(window)
	for (const script of snippet.scripts) {
		const pending = load(script)
		if (script.src) {
			// jsdom fetches nothing; stand in for the vendor bundle arriving.
			const el = [...document.head.querySelectorAll('script')].find(
				(candidate) => candidate.getAttribute('src') === script.src
			)
			el?.dispatchEvent(new Event('load'))
		}
		await pending
	}
}

const scriptSources = (): Array<string | null> =>
	[...document.querySelectorAll('script')].map((el) => el.getAttribute('src'))

const sinkArgs = (realm: VendorRealm) => ({
	slot: 'tenant' as const,
	win: realm as unknown as TrackerWindow,
	scripts: [],
	loadScript: () => Promise.resolve(),
})

beforeEach(() => {
	document.head.innerHTML = ''
})

describe('posthog snippet', () => {
	const snippet = () =>
		posthog({ projectId: '1', apiKey: 'phx_private', projectToken: 'phc_public' }).capture?.snippet(
			{ path: '/api/analytics/p/tenant' }
		) ?? { scripts: [] }

	it('publishes a callable stub and injects array.js off the proxy path', async () => {
		const realm = scriptRealm()
		await runSnippet(snippet())

		expect(typeof realm.posthog?.capture).toBe('function')
		expect(scriptSources()).toContain('/api/analytics/p/tenant/static/array.js')
		expect(realm.posthog?._i?.[0]).toEqual([
			'phc_public',
			{ api_host: '/api/analytics/p/tenant', ui_host: 'https://us.posthog.com' },
			'posthog',
		])
	})

	it('queues a sink dispatch made before the SDK lands', async () => {
		const realm = scriptRealm()
		await runSnippet(snippet())

		createPosthogSink(sinkArgs(realm)).send({
			type: 'event',
			name: 'signup',
			path: '/',
			hostname: 'shop.test',
		})

		expect([...(realm.posthog ?? [])]).toContainEqual(['capture', 'signup', {}])
	})
})

describe('plausible per-site snippet', () => {
	const snippet = () =>
		plausible({ siteId: 'example.com', apiKey: 'k', scriptId: 'abc123' }).capture?.snippet({
			path: '/api/analytics/p/tenant',
		}) ?? { scripts: [] }

	it('publishes the queue stub and parks the endpoint for the tracker', async () => {
		const realm = scriptRealm()
		await runSnippet(snippet())

		expect(typeof realm.plausible).toBe('function')
		expect(realm.plausible?.o).toEqual({ endpoint: '/api/analytics/p/tenant/api/event' })
	})

	it('queues a sink dispatch made before the tracker lands', async () => {
		const realm = scriptRealm()
		await runSnippet(snippet())

		createPlausibleSink(sinkArgs(realm)).send({
			type: 'goal',
			name: 'checkout',
			path: '/',
			hostname: 'shop.test',
			value: 49,
			currency: 'EUR',
		})

		const queued = [...(realm.plausible?.q ?? [])]
		expect(queued).toHaveLength(1)
		expect([...(queued[0] as unknown as unknown[])]).toEqual([
			'checkout',
			{ revenue: { amount: 49, currency: 'EUR' } },
		])
	})

	it('leaves a tracker that won the race against the inline alone', async () => {
		const realm = scriptRealm()
		const realInit = () => undefined
		const real = Object.assign(() => undefined, { init: realInit })
		realm.plausible = real as unknown as VendorRealm['plausible']

		await runSnippet(snippet())

		// Loader and inline can arrive in either order, so the stub must never clobber the
		// real tracker or the real init: the endpoint would be lost with it.
		expect(realm.plausible).toBe(real)
		expect(realm.plausible?.init).toBe(realInit)
	})
})
