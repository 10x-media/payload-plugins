import { afterEach, describe, expect, it, vi } from 'vitest'
import type { SnippetScript } from '../config'
import type { TrackerEvent, TrackerWindow } from '../types'
import { createGa4Sink } from './ga4'
import { createPlausibleSink } from './plausible'
import { createPosthogSink } from './posthog'
import { createUmamiSink } from './umami'
import { VENDOR_GLOBAL_TIMEOUT_MS } from './vendor'

const SCRIPTS: SnippetScript[] = [
	{ src: '/api/_x/p/global/static/array.js', async: true },
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
	gtag?: ReturnType<typeof vi.fn>
}

/** A window whose vendor globals appear only when the test says they do. */
const vendorWindow = () => {
	const capture = vi.fn()
	const plausible = vi.fn()
	const track = vi.fn()
	const gtag = vi.fn()
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
		win.gtag = gtag
	}
	return { win, capture, plausible, track, gtag, install }
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
		const { win, capture, plausible, track, gtag, install } = vendorWindow()
		install()
		const loadScript = vi.fn((_script: SnippetScript) => Promise.resolve())
		const args = { slot: 'tenant', win, scripts: SCRIPTS, loadScript } as const
		const sinks = [
			createPosthogSink(args),
			createPlausibleSink(args),
			createUmamiSink(args),
			createGa4Sink(args),
		]
		await Promise.all(sinks.map((sink) => sink.ready()))
		for (const sink of sinks) {
			sink.send(pageview)
		}

		expect(capture).not.toHaveBeenCalled()
		expect(plausible).not.toHaveBeenCalled()
		expect(track).not.toHaveBeenCalled()
		expect(gtag).not.toHaveBeenCalled()
	})

	it('never forwards an engagement: the vendor measures time and scroll itself', async () => {
		const { win, capture, plausible, track, gtag, install } = vendorWindow()
		install()
		const loadScript = vi.fn((_script: SnippetScript) => Promise.resolve())
		const args = { slot: 'tenant', win, scripts: SCRIPTS, loadScript } as const
		const sinks = [
			createPosthogSink(args),
			createPlausibleSink(args),
			createUmamiSink(args),
			createGa4Sink(args),
		]
		await Promise.all(sinks.map((sink) => sink.ready()))
		for (const sink of sinks) {
			sink.send({ ...pageview, type: 'engagement', durationMs: 4000, scrollDepth: 30 })
		}

		expect(capture).not.toHaveBeenCalled()
		expect(plausible).not.toHaveBeenCalled()
		expect(track).not.toHaveBeenCalled()
		expect(gtag).not.toHaveBeenCalled()
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

	it('ga4: gtag("event", name, { ...props, value, currency })', async () => {
		const { win, gtag, install } = vendorWindow()
		install()
		const sink = await ready(createGa4Sink, win)
		sink.send(purchase)
		sink.send({ type: 'event', name: 'signup', path: '/', hostname: 'shop.test' })

		expect(gtag).toHaveBeenNthCalledWith(1, 'event', 'checkout', {
			plan: 'pro',
			value: 49,
			currency: 'EUR',
		})
		expect(gtag).toHaveBeenNthCalledWith(2, 'event', 'signup', {})
	})

	it('hands every vendor the order id of a sale, GA4 as its transaction_id', async () => {
		const { win, capture, plausible, track, gtag, install } = vendorWindow()
		install()
		const sale: TrackerEvent = { ...purchase, orderId: 'ord_1' }
		for (const factory of [
			createPosthogSink,
			createPlausibleSink,
			createUmamiSink,
			createGa4Sink,
		]) {
			;(await ready(factory, win)).send(sale)
		}
		const flat = { plan: 'pro', orderId: 'ord_1', value: 49, currency: 'EUR' }
		expect(capture).toHaveBeenCalledWith('checkout', flat)
		expect(plausible).toHaveBeenCalledWith('checkout', {
			props: { plan: 'pro', orderId: 'ord_1' },
			revenue: { amount: 49, currency: 'EUR' },
		})
		expect(track).toHaveBeenCalledWith('checkout', flat)
		expect(gtag).toHaveBeenCalledWith('event', 'checkout', { ...flat, transaction_id: 'ord_1' })
	})

	// GA4 refuses a hyphen in an event name, so a kebab-case goal slug has to be normalized;
	// the other vendors take the slug as authored.
	it('ga4: sends a hyphenated goal slug under its GA4 event name', async () => {
		const { win, gtag, plausible, install } = vendorWindow()
		install()
		const goal: TrackerEvent = { ...purchase, name: 'checkout-complete' }
		const sink = await ready(createGa4Sink, win)
		sink.send(goal)
		const plausibleSink = await ready(createPlausibleSink, win)
		plausibleSink.send(goal)

		expect(gtag).toHaveBeenCalledWith('event', 'checkout_complete', {
			plan: 'pro',
			value: 49,
			currency: 'EUR',
		})
		expect(plausible).toHaveBeenCalledWith('checkout-complete', expect.anything())
	})
})

describe('content items at the vendors', () => {
	const click: TrackerEvent = {
		type: 'event',
		name: 'item_click',
		path: '/pricing',
		hostname: 'shop.test',
		item: 'offers:7',
		itemName: 'Spring sale',
	}
	const booked: TrackerEvent = { ...purchase, item: 'offers:7', itemName: 'Spring sale' }

	const ready = async (factory: typeof createPosthogSink, win: TrackerWindow) => {
		const sink = factory({ slot: 'global', win, scripts: [], loadScript: () => Promise.resolve() })
		await sink.ready()
		return sink
	}

	it('ga4: a click on an item is a select_promotion, in its promotion vocabulary', async () => {
		const { win, gtag, install } = vendorWindow()
		install()
		const sink = await ready(createGa4Sink, win)
		sink.send(click)

		expect(gtag).toHaveBeenCalledWith('event', 'select_promotion', {
			promotion_id: 'offers:7',
			promotion_name: 'Spring sale',
			items: [{ item_id: 'offers:7', item_name: 'Spring sale' }],
		})
	})

	it('sends every vendor the bare ref, without the signature only native checks', async () => {
		const signed: TrackerEvent = { ...click, item: 'offers:7@AbCdEf-_1234' }
		const ga = vendorWindow()
		ga.install()
		;(await ready(createGa4Sink, ga.win)).send(signed)
		expect(ga.gtag).toHaveBeenCalledWith('event', 'select_promotion', {
			promotion_id: 'offers:7',
			promotion_name: 'Spring sale',
			items: [{ item_id: 'offers:7', item_name: 'Spring sale' }],
		})

		const ph = vendorWindow()
		ph.install()
		;(await ready(createPosthogSink, ph.win)).send(signed)
		expect(ph.capture).toHaveBeenCalledWith('item_click', {
			item: 'offers:7',
			item_name: 'Spring sale',
		})
	})

	it('ga4: a goal on an item carries it as two parameters', async () => {
		const { win, gtag, install } = vendorWindow()
		install()
		const sink = await ready(createGa4Sink, win)
		sink.send(booked)

		expect(gtag).toHaveBeenCalledWith('event', 'checkout', {
			plan: 'pro',
			value: 49,
			currency: 'EUR',
			item: 'offers:7',
			item_name: 'Spring sale',
		})
	})

	it('plausible, umami and posthog: item_click with the item and its name as props', async () => {
		const { win, capture, plausible, track, install } = vendorWindow()
		install()
		const posthog = await ready(createPosthogSink, win)
		const umami = await ready(createUmamiSink, win)
		const plausibleSink = await ready(createPlausibleSink, win)
		posthog.send(click)
		umami.send(click)
		plausibleSink.send(click)

		const props = { item: 'offers:7', item_name: 'Spring sale' }
		expect(capture).toHaveBeenCalledWith('item_click', props)
		expect(track).toHaveBeenCalledWith('item_click', props)
		expect(plausible).toHaveBeenCalledWith('item_click', { props })
	})

	it('plausible: a goal on an item keeps its revenue and adds the item to its props', async () => {
		const { win, plausible, install } = vendorWindow()
		install()
		const sink = await ready(createPlausibleSink, win)
		sink.send(booked)

		expect(plausible).toHaveBeenCalledWith('checkout', {
			props: { plan: 'pro', item: 'offers:7', item_name: 'Spring sale' },
			revenue: { amount: 49, currency: 'EUR' },
		})
	})

	it('never forwards the items an engagement saw', async () => {
		const { win, capture, gtag, install } = vendorWindow()
		install()
		const posthog = await ready(createPosthogSink, win)
		const ga4 = await ready(createGa4Sink, win)
		const seen: TrackerEvent = {
			type: 'engagement',
			path: '/pricing',
			hostname: 'shop.test',
			impressions: ['offers:7'],
		}
		posthog.send(seen)
		ga4.send(seen)

		expect(capture).not.toHaveBeenCalled()
		expect(gtag).not.toHaveBeenCalled()
	})
})
