import { act, cleanup, render } from '@testing-library/react'
import { useEffect } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { TrackerConfig, TrackerSlotConfig } from '../capture/trackerConfig'
import type { TrackerEvent } from '../tracker/types'
import { AnalyticsProvider } from './AnalyticsProvider'
import { useAnalytics } from './useAnalytics'

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
	path: '/api/analytics/p/global',
	snippet: { scripts: [] },
	client: { kind: 'native' },
	requiresConsent: false,
}

const config: TrackerConfig = {
	slots: [nativeSlot],
	autoCapture: {
		scrollDepth: false,
		outboundLinks: false,
		fileDownloads: false,
		goalAttribute: false,
	},
	goals: [],
	ingestPath: '/api/analytics/ingest',
}

const Signup = () => {
	const { track } = useAnalytics()
	useEffect(() => {
		track('signup', { plan: 'pro' })
	}, [track])
	return null
}

beforeEach(() => {
	fetchMock.mockClear()
	window.fetch = fetchMock as unknown as typeof fetch
	window.localStorage.clear()
})

afterEach(() => {
	cleanup()
})

describe('AnalyticsProvider', () => {
	it('gives children a tracker they can send events through', () => {
		render(
			<AnalyticsProvider config={config}>
				<Signup />
			</AnalyticsProvider>
		)

		expect(posted()).toEqual([
			expect.objectContaining({ type: 'event', name: 'signup', props: { plan: 'pro' } }),
		])
	})

	it('creates one tracker across re-renders', () => {
		const { rerender } = render(
			<AnalyticsProvider config={{ ...config }}>{null}</AnalyticsProvider>
		)
		rerender(<AnalyticsProvider config={{ ...config }}>{null}</AnalyticsProvider>)
		rerender(<AnalyticsProvider config={{ ...config }}>{null}</AnalyticsProvider>)

		act(() => {
			window.dispatchEvent(new Event('pagehide'))
		})

		expect(posted().filter((event) => event.type === 'pageview')).toHaveLength(1)
	})

	it('destroys the tracker on unmount', () => {
		const { unmount } = render(<AnalyticsProvider config={config}>{null}</AnalyticsProvider>)
		unmount()
		fetchMock.mockClear()

		act(() => {
			window.dispatchEvent(new Event('pagehide'))
		})

		expect(fetchMock).not.toHaveBeenCalled()
	})
})

describe('useAnalytics', () => {
	it('throws outside a provider', () => {
		const onError = vi.spyOn(console, 'error').mockImplementation(() => undefined)

		expect(() => render(<Signup />)).toThrow(/AnalyticsProvider/)

		onError.mockRestore()
	})

	it('exposes track, trackGoal and consent', () => {
		let api: ReturnType<typeof useAnalytics> | null = null
		const Probe = () => {
			api = useAnalytics()
			return null
		}
		render(
			<AnalyticsProvider config={config}>
				<Probe />
			</AnalyticsProvider>
		)

		expect(Object.keys(api ?? {}).sort()).toEqual(['consent', 'track', 'trackGoal'])
	})
})
