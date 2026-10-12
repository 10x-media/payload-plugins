import { act, cleanup, render } from '@testing-library/react'
import { useEffect } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { TrackerConfig, TrackerSlotConfig } from '../tracker/config'
import { EXCLUSION_STORAGE_KEY } from '../tracker/exclusion'
import { forgetWindowGate, liveTracker } from '../tracker/registry'
import type { TrackerEvent } from '../tracker/types'
import { AnalyticsProvider } from './AnalyticsProvider'
import { TrackerBoot } from './TrackerBoot'
import { useAnalytics } from './useAnalytics'

const fetchMock = vi.fn(() => Promise.resolve(new Response(null, { status: 202 })))

/** What the api sent. The boot pageview goes out on its own, so it is left out. */
const posted = (): TrackerEvent[] =>
	fetchMock.mock.calls
		.map(
			(call) =>
				JSON.parse((call as unknown as [string, RequestInit])[1].body as string) as TrackerEvent
		)
		.filter((event) => event.type !== 'pageview')

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
	forgetWindowGate(window)
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

	it('files an event and a goal under the content item a call names', () => {
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
			api?.track('cta_click', undefined, { item: 'offers:7' })
			api?.trackGoal('book-demo', { item: 'offers:7' })
		})

		expect(posted().map((event) => event.item)).toEqual(['offers:7', 'offers:7'])
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

	it('reports the exclusion flag, flips it, and re-renders the caller', () => {
		const latest: { api: ReturnType<typeof useAnalytics> | null } = { api: null }
		render(
			<>
				<TrackerBoot config={config} />
				<Probe
					onApi={(a) => {
						latest.api = a
					}}
				/>
			</>
		)
		expect(latest.api?.excluded).toBe(false)

		act(() => {
			latest.api?.setExcluded(true)
		})

		expect(latest.api?.excluded).toBe(true)
		expect(window.localStorage.getItem(EXCLUSION_STORAGE_KEY)).toBe('1')
		act(() => {
			latest.api?.track('skipped')
		})
		expect(posted()).toEqual([])

		act(() => {
			latest.api?.setExcluded(false)
		})

		expect(latest.api?.excluded).toBe(false)
		act(() => {
			latest.api?.track('signup')
		})
		expect(posted()).toEqual([expect.objectContaining({ name: 'signup' })])
	})

	// Storage access needs the visitor's consent as much as a cookie does (ePrivacy Art. 5(3)).
	it('reads no storage to render, and reports a stored flag only once a slot opened', () => {
		window.localStorage.setItem(EXCLUSION_STORAGE_KEY, '1')
		const getItem = vi.spyOn(Storage.prototype, 'getItem')
		const gated: TrackerConfig = { ...config, slots: [{ ...nativeSlot, gated: true }] }
		const latest: { api: ReturnType<typeof useAnalytics> | null } = { api: null }
		const probe = (
			<Probe
				onApi={(a) => {
					latest.api = a
				}}
			/>
		)
		const view = render(probe)
		expect(latest.api?.excluded).toBe(false)

		view.rerender(
			<>
				<TrackerBoot config={gated} />
				{probe}
			</>
		)
		expect(latest.api?.excluded).toBe(false)
		expect(getItem).not.toHaveBeenCalled()

		act(() => {
			latest.api?.setGate(true)
		})

		expect(getItem).toHaveBeenCalledWith(EXCLUSION_STORAGE_KEY)
		expect(latest.api?.excluded).toBe(true)
		expect(fetchMock).not.toHaveBeenCalled()
		getItem.mockRestore()
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

	// A consent manager's bridge often answers before the boot effect runs, and must not throw.
	it('keeps a setGate made before any tracker exists, and the tracker boots with it', () => {
		const gated: TrackerConfig = { ...config, slots: [{ ...nativeSlot, gated: true }] }
		const latest: { api: ReturnType<typeof useAnalytics> | null } = { api: null }
		const Bridge = () => {
			const api = useAnalytics()
			latest.api = api
			const { setGate } = api
			useEffect(() => {
				setGate(true)
			}, [setGate])
			return null
		}

		expect(() =>
			render(
				<>
					<Bridge />
					<TrackerBoot config={gated} />
				</>
			)
		).not.toThrow()

		expect(liveTracker(window)?.gate.global).toBe('open')
		expect(latest.api?.gate.global).toBe('open')
		act(() => {
			latest.api?.track('signup')
		})
		expect(posted()).toEqual([expect.objectContaining({ name: 'signup' })])
	})

	it('reports each slot gate, a held one pending before any answer, and re-renders the caller on a change', () => {
		const gated: TrackerConfig = { ...config, slots: [{ ...nativeSlot, gated: true }] }
		const latest: { api: ReturnType<typeof useAnalytics> | null } = { api: null }
		render(
			<>
				<TrackerBoot config={gated} />
				<Probe
					onApi={(a) => {
						latest.api = a
					}}
				/>
			</>
		)
		// The config fills no tenant slot, so nothing there can ever be captured.
		expect(latest.api?.gate).toEqual({ global: 'pending', tenant: 'closed' })

		act(() => {
			latest.api?.setGate({ global: false })
		})

		expect(latest.api?.gate.global).toBe('closed')
		expect(fetchMock).not.toHaveBeenCalled()
	})
})

describe('useAnalytics under a provider', () => {
	it('flips the exclusion flag through the provider tracker', () => {
		const latest: { api: ReturnType<typeof useAnalytics> | null } = { api: null }
		render(
			<AnalyticsProvider config={config}>
				<Probe
					onApi={(a) => {
						latest.api = a
					}}
				/>
			</AnalyticsProvider>
		)

		act(() => {
			latest.api?.setExcluded(true)
		})

		expect(latest.api?.excluded).toBe(true)
		act(() => {
			latest.api?.track('skipped')
		})
		expect(posted()).toEqual([])
	})

	it('files an event under the content item a call names, through the provider tracker', () => {
		const latest: { api: ReturnType<typeof useAnalytics> | null } = { api: null }
		render(
			<AnalyticsProvider config={config}>
				<Probe
					onApi={(a) => {
						latest.api = a
					}}
				/>
			</AnalyticsProvider>
		)

		act(() => {
			latest.api?.track('cta_click', undefined, { item: 'offers:7' })
		})
		expect(posted()).toEqual([expect.objectContaining({ name: 'cta_click', item: 'offers:7' })])
	})
})
