import { afterEach, describe, expect, it, vi } from 'vitest'
import type { SnippetScript } from '../../core/capture'
import type { TrackerEvent, TrackerWindow } from '../types'
import { createPlausibleSink } from './plausible'
import { createPosthogSink } from './posthog'
import { createUmamiSink } from './umami'
import { VENDOR_GLOBAL_TIMEOUT_MS } from './vendor'

const SCRIPTS: SnippetScript[] = [
	{ src: '/api/analytics/p/global/static/array.js', async: true },
	{ inline: 'window.__vendorInit()' },
]

const pageview: TrackerEvent = { type: 'pageview', path: '/pricing', hostname: 'shop.test' }
const purchase: TrackerEvent = {
	type: 'goal',
	name: 'checkout',
	path: '/thanks',
	hostname: 'shop.test',
	props: { plan: 'pro' },
	value: 49,
	currency: 'EUR',
}

interface VendorGlobals {
	posthog?: { capture: ReturnType<typeof vi.fn> }
	plausible?: ReturnType<typeof vi.fn>
	umami?: { track: ReturnType<typeof vi.fn> }
}

/** A window whose vendor globals appear only when the test says they do. */
const vendorWindow = () => {
	const capture = vi.fn()
	const plausible = vi.fn()
	const track = vi.fn()
	const globals: VendorGlobals = {}
	const win = {
		...globals,
		setTimeout: (fn: () => void, ms?: number) => globalThis.setTimeout(fn, ms),
		clearTimeout: (id: ReturnType<typeof globalThis.setTimeout>) => globalThis.clearTimeout(id),
	} as unknown as TrackerWindow & VendorGlobals
	const install = () => {
		win.posthog = { capture }
		win.plausible = plausible
		win.umami = { track }
	}
	return { win, capture, plausible, track, install }
}

afterEach(() => {
	vi.useRealTimers()
})

describe('vendor sink loading', () => {
	it('loads the slot scripts in order, once, before dispatching', async () => {
		const { win, capture, install } = vendorWindow()
		const loadScript = vi.fn((script: SnippetScript) => {
			if (script.inline) {
				install()
			}
			return Promise.resolve()
		})
		const sink = createPosthogSink({ slot: 'global', win, scripts: SCRIPTS, loadScript })

		sink.send({ type: 'event', name: 'signup', path: '/', hostname: 'shop.test' })
		expect(capture).not.toHaveBeenCalled()

		await vi.waitFor(() => {
			expect(capture).toHaveBeenCalledTimes(1)
		})
		expect(loadScript.mock.calls.map((call) => call[0])).toEqual(SCRIPTS)

		sink.send({ type: 'event', name: 'again', path: '/', hostname: 'shop.test' })
		expect(capture).toHaveBeenCalledTimes(2)
		expect(loadScript).toHaveBeenCalledTimes(SCRIPTS.length)
	})

	it('dispatches straight away when the page already carries the vendor stub', () => {
		const { win, capture, install } = vendorWindow()
		install()
		const loadScript = vi.fn((_script: SnippetScript) => Promise.resolve())
		const sink = createPosthogSink({ slot: 'global', win, scripts: SCRIPTS, loadScript })

		sink.send({ type: 'event', name: 'signup', path: '/', hostname: 'shop.test' })

		expect(capture).toHaveBeenCalledTimes(1)
	})

	it('drops events when the vendor script cannot load', async () => {
		const { win, capture } = vendorWindow()
		const loadScript = vi.fn((_script: SnippetScript) => Promise.reject(new Error('blocked')))
		const sink = createPosthogSink({ slot: 'global', win, scripts: SCRIPTS, loadScript })

		await expect(sink.ready()).rejects.toThrow('blocked')
		sink.send({ type: 'event', name: 'signup', path: '/', hostname: 'shop.test' })
		await vi.waitFor(() => {
			expect(loadScript).toHaveBeenCalledTimes(1)
		})
		expect(capture).not.toHaveBeenCalled()
	})

	it('waits for a global that appears after its script loads', async () => {
		vi.useFakeTimers()
		const { win, track, install } = vendorWindow()
		// Umami defines its global only once the tracker script has actually run.
		const loadScript = vi.fn((_script: SnippetScript) => {
			globalThis.setTimeout(install, 300)
			return Promise.resolve()
		})
		const sink = createUmamiSink({ slot: 'tenant', win, scripts: SCRIPTS, loadScript })

		sink.send({ type: 'event', name: 'signup', path: '/', hostname: 'shop.test' })
		await vi.advanceTimersByTimeAsync(1000)

		expect(track).toHaveBeenCalledWith('signup', {})
	})

	it('drops the event when the global never appears, without disturbing anyone', async () => {
		vi.useFakeTimers()
		const { win, track, capture, install } = vendorWindow()
		const loadScript = vi.fn((_script: SnippetScript) => Promise.resolve())
		const silent = createUmamiSink({ slot: 'tenant', win, scripts: SCRIPTS, loadScript })
		install()
		delete (win as VendorGlobals).umami
		const working = createPosthogSink({ slot: 'global', win, scripts: [], loadScript })

		silent.send({ type: 'event', name: 'signup', path: '/', hostname: 'shop.test' })
		working.send({ type: 'event', name: 'signup', path: '/', hostname: 'shop.test' })
		await vi.advanceTimersByTimeAsync(VENDOR_GLOBAL_TIMEOUT_MS + 1000)

		expect(track).not.toHaveBeenCalled()
		expect(capture).toHaveBeenCalledTimes(1)
	})

	it('never forwards a pageview: the vendor script tracks its own', async () => {
		const { win, capture, plausible, track, install } = vendorWindow()
		install()
		const loadScript = vi.fn((_script: SnippetScript) => Promise.resolve())
		const args = { slot: 'tenant', win, scripts: SCRIPTS, loadScript } as const
		const sinks = [createPosthogSink(args), createPlausibleSink(args), createUmamiSink(args)]
		await Promise.all(sinks.map((sink) => sink.ready()))
		for (const sink of sinks) {
			sink.send(pageview)
		}

		expect(capture).not.toHaveBeenCalled()
		expect(plausible).not.toHaveBeenCalled()
		expect(track).not.toHaveBeenCalled()
	})
})

describe('vendor call shapes', () => {
	const ready = async (
		factory: typeof createPosthogSink,
		win: TrackerWindow
	): Promise<ReturnType<typeof createPosthogSink>> => {
		const sink = factory({ slot: 'global', win, scripts: [], loadScript: () => Promise.resolve() })
		await sink.ready()
		return sink
	}

	it('posthog: capture(name, { ...props, value, currency })', async () => {
		const { win, capture, install } = vendorWindow()
		install()
		const sink = await ready(createPosthogSink, win)
		sink.send(purchase)
		sink.send({ type: 'event', name: 'signup', path: '/', hostname: 'shop.test' })

		expect(capture).toHaveBeenNthCalledWith(1, 'checkout', {
			plan: 'pro',
			value: 49,
			currency: 'EUR',
		})
		expect(capture).toHaveBeenNthCalledWith(2, 'signup', {})
	})

	it('plausible: plausible(name, { props, revenue })', async () => {
		const { win, plausible, install } = vendorWindow()
		install()
		const sink = await ready(createPlausibleSink, win)
		sink.send(purchase)
		sink.send({ type: 'event', name: 'signup', path: '/', hostname: 'shop.test' })

		expect(plausible).toHaveBeenNthCalledWith(1, 'checkout', {
			props: { plan: 'pro' },
			revenue: { amount: 49, currency: 'EUR' },
		})
		expect(plausible).toHaveBeenNthCalledWith(2, 'signup', {})
	})

	it('umami: track(name, { ...props, value, currency })', async () => {
		const { win, track, install } = vendorWindow()
		install()
		const sink = await ready(createUmamiSink, win)
		sink.send(purchase)

		expect(track).toHaveBeenCalledWith('checkout', { plan: 'pro', value: 49, currency: 'EUR' })
	})
})
