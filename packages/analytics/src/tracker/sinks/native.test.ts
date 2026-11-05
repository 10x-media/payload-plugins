import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { SlotMode } from '../config'
import type { TrackerEvent } from '../types'
import { createNativeSink } from './native'

const fetchMock = vi.fn(() => Promise.resolve(new Response(null, { status: 202 })))

const sent = (): TrackerEvent[] =>
	fetchMock.mock.calls.map(
		(call) =>
			JSON.parse((call as unknown as [string, RequestInit])[1].body as string) as TrackerEvent
	)

const pageview: TrackerEvent = { type: 'pageview', path: '/pricing', hostname: 'shop.test' }

const sink = () => createNativeSink({ slot: 'global', win: window, url: '/api/_x/e' })

beforeEach(() => {
	fetchMock.mockClear()
	vi.stubGlobal('fetch', fetchMock)
	window.fetch = fetchMock as unknown as typeof fetch
	vi.useFakeTimers()
})

afterEach(() => {
	vi.useRealTimers()
	vi.unstubAllGlobals()
})

describe('createNativeSink', () => {
	it('posts an event immediately, in the ingest wire shape', () => {
		sink().send({
			type: 'event',
			name: 'signup',
			path: '/pricing',
			hostname: 'shop.test',
			referrer: 'https://google.com/',
			props: { plan: 'pro' },
		})

		expect(sent()).toEqual([
			{
				type: 'event',
				name: 'signup',
				path: '/pricing',
				hostname: 'shop.test',
				referrer: 'https://google.com/',
				props: { plan: 'pro' },
			},
		])
	})

	it('posts a goal immediately, with its value and currency', () => {
		sink().send({
			type: 'goal',
			name: 'checkout',
			path: '/thanks',
			hostname: 'shop.test',
			value: 49,
			currency: 'EUR',
		})

		expect(sent()[0]).toMatchObject({ type: 'goal', name: 'checkout', value: 49, currency: 'EUR' })
	})

	it('posts a pageview the moment it is sent, holding nothing back for its duration', () => {
		sink().send({ ...pageview, query: 'utm_source=newsletter', scrollDepth: 0 })

		expect(sent()).toEqual([
			{
				type: 'pageview',
				path: '/pricing',
				hostname: 'shop.test',
				query: 'utm_source=newsletter',
				scrollDepth: 0,
			},
		])
		vi.advanceTimersByTime(60_000)
		expect(sent()).toHaveLength(1)
	})

	it('posts an engagement verbatim', () => {
		sink().send({ type: 'engagement', path: '/pricing', hostname: 'shop.test', durationMs: 4000 })

		expect(sent()).toEqual([
			{ type: 'engagement', path: '/pricing', hostname: 'shop.test', durationMs: 4000 },
		])
	})

	it('posts the item an event belongs to, and leaves its name for the vendors', () => {
		sink().send({
			type: 'event',
			name: 'item_click',
			path: '/pricing',
			hostname: 'shop.test',
			item: 'offers:1',
			itemName: 'Spring sale',
		})

		expect(sent()).toEqual([
			{
				type: 'event',
				name: 'item_click',
				path: '/pricing',
				hostname: 'shop.test',
				item: 'offers:1',
			},
		])
	})

	it('posts the items an engagement saw', () => {
		sink().send({
			type: 'engagement',
			path: '/pricing',
			hostname: 'shop.test',
			impressions: ['offers:1', 'offers:2'],
		})

		expect(sent()[0]?.impressions).toEqual(['offers:1', 'offers:2'])
	})

	it('is ready without loading anything', async () => {
		await expect(sink().ready()).resolves.toBeUndefined()
	})
})

describe('the native sink by mode', () => {
	const engagement: TrackerEvent = { ...pageview, type: 'engagement', durationMs: 4000 }
	const modal = (mode: SlotMode) =>
		createNativeSink({ slot: 'global', win: window, url: '/api/_x/e', mode: () => mode })

	it.each([
		['cookieless', 'c'],
		['anonymous', 'a'],
	] as const)('stamps a %s beacon with m: %s', (mode, m) => {
		modal(mode).send(pageview)
		expect(sent()).toEqual([{ ...pageview, m }])
	})

	it('sends a full beacon exactly as a tracker from before modes did', () => {
		modal('full').send(pageview)
		expect(sent()).toEqual([pageview])
	})

	it('reads the mode as each event is sent', () => {
		let mode: SlotMode = 'cookieless'
		const live = createNativeSink({ slot: 'global', win: window, url: '/e', mode: () => mode })
		live.send(pageview)
		mode = 'full'
		live.send(pageview)
		expect(sent()).toEqual([{ ...pageview, m: 'c' }, pageview])
	})

	it('sends no engagement while anonymous, which keeps none', () => {
		modal('anonymous').send(engagement)
		modal('cookieless').send(engagement)
		expect(sent()).toEqual([{ ...engagement, m: 'c' }])
	})
})
