import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { TrackerEvent } from '../types'
import { createNativeSink, PAGEVIEW_BUFFER_MS } from './native'

const fetchMock = vi.fn(() => Promise.resolve(new Response(null, { status: 202 })))

const sent = (): TrackerEvent[] =>
	fetchMock.mock.calls.map(
		(call) =>
			JSON.parse((call as unknown as [string, RequestInit])[1].body as string) as TrackerEvent
	)

const pageview: TrackerEvent = { type: 'pageview', path: '/pricing', hostname: 'shop.test' }

const sink = (scrollDepth?: () => number | undefined) =>
	createNativeSink({ slot: 'global', win: window, url: '/api/analytics/ingest', scrollDepth })

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

	it('buffers a pageview until flush, then adds duration and scroll depth', () => {
		const native = sink(() => 75)
		native.send(pageview)
		expect(fetchMock).not.toHaveBeenCalled()

		vi.advanceTimersByTime(4000)
		native.flush?.()

		expect(sent()).toEqual([
			{
				type: 'pageview',
				path: '/pricing',
				hostname: 'shop.test',
				durationMs: 4000,
				scrollDepth: 75,
			},
		])
	})

	it('omits scrollDepth when the scroll listener is off', () => {
		const native = sink(() => undefined)
		native.send(pageview)
		native.flush?.()

		expect(sent()[0]).not.toHaveProperty('scrollDepth')
	})

	it('flushes a buffered pageview after the buffer window', () => {
		sink().send(pageview)
		vi.advanceTimersByTime(PAGEVIEW_BUFFER_MS)

		expect(sent()).toHaveLength(1)
		expect(sent()[0]?.durationMs).toBe(PAGEVIEW_BUFFER_MS)
	})

	it('flushes the previous pageview when the next navigation arrives', () => {
		const native = sink()
		native.send(pageview)
		vi.advanceTimersByTime(1500)
		native.send({ ...pageview, path: '/checkout' })

		expect(sent()).toHaveLength(1)
		expect(sent()[0]).toMatchObject({ path: '/pricing', durationMs: 1500 })
	})

	it('sends a buffered pageview exactly once', () => {
		const native = sink()
		native.send(pageview)
		native.flush?.()
		native.flush?.()
		vi.advanceTimersByTime(PAGEVIEW_BUFFER_MS)

		expect(sent()).toHaveLength(1)
	})

	it('is ready without loading anything', async () => {
		await expect(sink().ready()).resolves.toBeUndefined()
	})
})
