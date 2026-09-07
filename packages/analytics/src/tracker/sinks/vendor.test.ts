import { describe, expect, it, vi } from 'vitest'
import type { SnippetScript } from '../../core/capture'
import type { TrackerEvent, TrackerWindow } from '../types'
import { createPlausibleSink } from './plausible'
import { createPosthogSink } from './posthog'
import { createUmamiSink } from './umami'

const SCRIPTS: SnippetScript[] = [
	{ src: '/api/analytics/p/global/static/array.js', async: true },
	{ inline: 'window.posthog.init("tok")' },
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

const vendorWindow = () => {
	const capture = vi.fn()
	const plausible = vi.fn()
	const track = vi.fn()
	const win = { posthog: { capture }, plausible, umami: { track } } as unknown as TrackerWindow
	return { win, capture, plausible, track }
}

describe('vendor sink loading', () => {
	it('loads the slot scripts in order, once, before dispatching', async () => {
		const { win, capture } = vendorWindow()
		const loadScript = vi.fn((_script: SnippetScript) => Promise.resolve())
		const sink = createPosthogSink({ slot: 'global', win, scripts: SCRIPTS, loadScript })

		sink.send({ type: 'event', name: 'signup', path: '/', hostname: 'shop.test' })
		expect(capture).not.toHaveBeenCalled()

		await sink.ready()
		await vi.waitFor(() => {
			expect(capture).toHaveBeenCalledTimes(1)
		})
		expect(loadScript.mock.calls.map((call) => call[0])).toEqual(SCRIPTS)

		sink.send({ type: 'event', name: 'again', path: '/', hostname: 'shop.test' })
		expect(capture).toHaveBeenCalledTimes(2)
		expect(loadScript).toHaveBeenCalledTimes(SCRIPTS.length)
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

	it('never forwards a pageview: the vendor script tracks its own', async () => {
		const { win, capture, plausible, track } = vendorWindow()
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
		const { win, capture } = vendorWindow()
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
		const { win, plausible } = vendorWindow()
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
		const { win, track } = vendorWindow()
		const sink = await ready(createUmamiSink, win)
		sink.send(purchase)

		expect(track).toHaveBeenCalledWith('checkout', { plan: 'pro', value: 49, currency: 'EUR' })
	})

	it('stays quiet when the vendor global never appeared', async () => {
		const win = {} as TrackerWindow
		const sinks = await Promise.all([
			ready(createPosthogSink, win),
			ready(createPlausibleSink, win),
			ready(createUmamiSink, win),
		])

		expect(() => {
			for (const sink of sinks) {
				sink.send(purchase)
			}
		}).not.toThrow()
	})
})
