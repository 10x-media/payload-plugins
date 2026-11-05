import { act, cleanup, render } from '@testing-library/react'
import { StrictMode, useEffect } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { TrackerConfig, TrackerSlotConfig } from '../tracker/config'
import { liveTracker } from '../tracker/registry'
import type { TrackerEvent } from '../tracker/types'
import { TrackerBoot } from './TrackerBoot'

const fetchMock = vi.fn(() => Promise.resolve(new Response(null, { status: 202 })))

const posted = (): TrackerEvent[] =>
	fetchMock.mock.calls.map(
		(call) =>
			JSON.parse((call as unknown as [string, RequestInit])[1].body as string) as TrackerEvent
	)

const nativeSlot: TrackerSlotConfig = {
	slot: 'global',
	kind: 'native',
	adapterId: 'native',
	path: '/api/_x/p/global',
	snippet: { scripts: [] },
	client: { kind: 'native' },
	gated: false,
}

const config: TrackerConfig = {
	slots: [nativeSlot],
	autoCapture: {
		scrollDepth: false,
		outboundLinks: false,
		fileDownloads: false,
		goalAttribute: false,
		query: false,
		items: { impressions: false, clicks: false, pages: false },
	},
	goals: [],
	ingestPath: '/api/_x/e',
}

/** Lets the registry's deferred teardown macrotask run. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 0))

beforeEach(() => {
	fetchMock.mockClear()
	window.fetch = fetchMock as unknown as typeof fetch
	window.localStorage.clear()
})

afterEach(async () => {
	cleanup()
	await settle()
})

describe('TrackerBoot', () => {
	it('renders nothing', () => {
		const { container } = render(<TrackerBoot config={config} />)

		expect(container.innerHTML).toBe('')
	})

	it('boots one tracker across re-renders', () => {
		const { rerender } = render(<TrackerBoot config={{ ...config }} />)
		rerender(<TrackerBoot config={{ ...config }} />)
		rerender(<TrackerBoot config={{ ...config }} />)

		act(() => {
			window.dispatchEvent(new Event('pagehide'))
		})

		expect(posted().filter((event) => event.type === 'pageview')).toHaveLength(1)
	})

	it('boots exactly one tracker under StrictMode', () => {
		let effectRuns = 0
		const Probe = () => {
			useEffect(() => {
				effectRuns += 1
			}, [])
			return null
		}
		render(
			<StrictMode>
				<Probe />
				<TrackerBoot config={config} />
			</StrictMode>
		)

		// Guards the test itself: without a double-invoked mount there is nothing to prove.
		expect(effectRuns).toBe(2)
		act(() => {
			window.dispatchEvent(new Event('pagehide'))
		})
		expect(posted().filter((event) => event.type === 'pageview')).toHaveLength(1)
	})

	describe('the gate and the snippets it is handed', () => {
		const gated: TrackerConfig = {
			...config,
			slots: [
				{
					slot: 'tenant',
					kind: 'plausible',
					adapterId: 'plausible',
					path: '/api/_x/p/tenant',
					snippet: { scripts: [{ src: '/pl/script.js' }] },
					client: { kind: 'plausible' },
					gated: true,
				},
			],
		}

		const injected = () => document.head.querySelector('script[src="/pl/script.js"]')

		afterEach(() => {
			injected()?.remove()
		})

		it('opens a slot the server already had an answer for, and injects its snippet', async () => {
			render(<TrackerBoot config={gated} gate={{ tenant: true }} />)

			expect(liveTracker(window)?.gate.tenant).toBe('open')
			await vi.waitFor(() => {
				expect(injected()).not.toBeNull()
			})
		})

		it('boots pending without an answer, and injects nothing until setGate opens it', async () => {
			render(<TrackerBoot config={gated} />)
			expect(liveTracker(window)?.gate.tenant).toBe('pending')
			await settle()
			expect(injected()).toBeNull()

			act(() => {
				liveTracker(window)?.setGate(true)
			})

			await vi.waitFor(() => {
				expect(injected()).not.toBeNull()
			})
		})

		it('injects nothing under snippets={false}, even once open', async () => {
			render(<TrackerBoot config={gated} gate={true} snippets={false} />)

			expect(liveTracker(window)?.gate.tenant).toBe('open')
			await settle()
			expect(injected()).toBeNull()
		})
	})

	it('destroys its tracker on unmount', async () => {
		const { unmount } = render(<TrackerBoot config={config} />)
		unmount()
		await settle()
		fetchMock.mockClear()

		act(() => {
			window.dispatchEvent(new Event('pagehide'))
		})

		expect(fetchMock).not.toHaveBeenCalled()
	})
})
