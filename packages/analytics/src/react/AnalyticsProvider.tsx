'use client'

import {
	createContext,
	type ReactElement,
	type ReactNode,
	useCallback,
	useEffect,
	useMemo,
	useRef,
} from 'react'
import type { TrackerConfig } from '../capture/trackerConfig'
import { acquireTracker, type TrackerLease } from '../tracker/registry'
import type { LoadScript, Tracker } from '../tracker/types'

/** The tracker surface a component gets from `useAnalytics`. */
export interface AnalyticsApi {
	track: Tracker['track']
	trackGoal: Tracker['trackGoal']
	consent: Tracker['consent']
}

export const AnalyticsContext = createContext<AnalyticsApi | null>(null)

export interface AnalyticsProviderProps {
	/** Resolved server-side by `getTrackerConfig`, or fetched from the tracker endpoint. */
	config: TrackerConfig
	children?: ReactNode
	/** CSP nonce applied to the vendor scripts the tracker injects. */
	nonce?: string
	/** Replaces script injection, for a consent manager or a framework script loader. */
	loadScript?: LoadScript
}

/**
 * Shares the window's tracker with the tree through `useAnalytics`. Use it when components
 * need to call `track`, `trackGoal`, or `consent` themselves; a page that only needs
 * pageviews and auto-capture can render `<AnalyticsScripts />` (which boots
 * `<TrackerBoot />`) and skip the provider. Rendering both is fine: the tracker is leased
 * from a per-window registry, so there is still only one.
 *
 * The lease is taken lazily in the browser rather than during render, so server rendering
 * stays inert and React's double-invoked render cannot leak a second tracker.
 *
 * Whichever component boots the tracker first owns its options, so a `nonce` or
 * `loadScript` passed to a provider that mounts after `<TrackerBoot />` is ignored: give
 * them to whatever boots first, or render only one of the two.
 */
export const AnalyticsProvider = ({
	config,
	children,
	nonce,
	loadScript,
}: AnalyticsProviderProps): ReactElement => {
	const boot = useRef({ config, nonce, loadScript })
	boot.current = { config, nonce, loadScript }
	const lease = useRef<TrackerLease | null>(null)
	const unmounted = useRef(false)

	const ensure = useCallback((): Tracker | null => {
		if (!lease.current && !unmounted.current && typeof window !== 'undefined') {
			const { config: current, nonce: currentNonce, loadScript: currentLoad } = boot.current
			lease.current = acquireTracker(current, { nonce: currentNonce, loadScript: currentLoad })
		}
		return lease.current?.tracker ?? null
	}, [])

	useEffect(() => {
		unmounted.current = false
		ensure()
		return () => {
			// A stale `track` call held past unmount must not resurrect the tracker.
			unmounted.current = true
			lease.current?.release()
			lease.current = null
		}
	}, [ensure])

	const api = useMemo<AnalyticsApi>(
		() => ({
			track: (name, props) => ensure()?.track(name, props),
			trackGoal: (slug, opts) => ensure()?.trackGoal(slug, opts),
			consent: (state) => ensure()?.consent(state),
		}),
		[ensure]
	)

	return <AnalyticsContext.Provider value={api}>{children}</AnalyticsContext.Provider>
}
