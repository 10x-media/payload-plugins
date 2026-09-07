import { act, cleanup, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { TrackerConfig, TrackerSlotConfig } from '../capture/trackerConfig'
import type { TrackerEvent } from '../tracker/types'
import { TrackerBoot } from './TrackerBoot'
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

/** Lets the registry's deferred teardown macrotask run. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 0))

/** Captures the api at render time, which is before any sibling effect has run. */
const Probe = ({ onApi }: { onApi: (api: ReturnType<typeof useAnalytics>) => void }) => {
	onApi(useAnalytics())
	return null
}

beforeEach(() => {
	fetchMock.mockClear()
	window.fetch = fetchMock as unknown as typeof fetch
	window.localStorage.clear()
})

afterEach(async () => {
	cleanup()
	await settle()
})

describe('useAnalytics without a provider', () => {
	it('tracks through the tracker TrackerBoot acquired', () => {
		let api: ReturnType<typeof useAnalytics> | null = null
		render(
			<>
				<TrackerBoot config={config} />
				<Probe
					onApi={(a) => {
						api = a
					}}
				/>
			</>
		)

		act(() => {
			api?.track('signup', { plan: 'pro' })
		})

		expect(posted()).toEqual([
			expect.objectContaining({ type: 'event', name: 'signup', props: { plan: 'pro' } }),
		])
	})

	// The api is read during render, when TrackerBoot's effect has not run yet: resolving the
	// tracker eagerly there would capture null and never recover.
	it('resolves the tracker at call time, not at render time', () => {
		let api: ReturnType<typeof useAnalytics> | null = null
		render(
			<>
				<Probe
					onApi={(a) => {
						api = a
					}}
				/>
				<TrackerBoot config={config} />
			</>
		)

		act(() => {
			api?.trackGoal('book-demo')
		})

		expect(posted()).toEqual([expect.objectContaining({ type: 'goal', name: 'book-demo' })])
	})

	it('renders fine with no tracker at all and throws only when a call is made', () => {
		let api: ReturnType<typeof useAnalytics> | null = null
		expect(() =>
			render(
				<Probe
					onApi={(a) => {
						api = a
					}}
				/>
			)
		).not.toThrow()

		expect(() => api?.track('signup')).toThrow(/AnalyticsProvider|AnalyticsScripts/)
		expect(fetchMock).not.toHaveBeenCalled()
	})
})
