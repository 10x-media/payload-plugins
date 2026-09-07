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
import { createTracker } from '../tracker/createTracker'
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
 * Creates the tracker once and shares it with the tree through `useAnalytics`. Use it when
 * components need to call `track`, `trackGoal`, or `consent` themselves; a page that only
 * needs pageviews and auto-capture can render `<AnalyticsScripts />` (which boots
 * `<TrackerBoot />`) and skip the provider. Never both: each boots its own tracker.
 *
 * The tracker is created lazily in the browser rather than during render, so server
 * rendering stays inert and React's double-invoked render cannot leak a second one.
 */
export const AnalyticsProvider = ({
	config,
	children,
	nonce,
	loadScript,
}: AnalyticsProviderProps): ReactElement => {
	const boot = useRef({ config, nonce, loadScript })
	boot.current = { config, nonce, loadScript }
	const tracker = useRef<Tracker | null>(null)

	const ensure = useCallback((): Tracker | null => {
		if (!tracker.current && typeof window !== 'undefined') {
			const { config: current, nonce: currentNonce, loadScript: currentLoad } = boot.current
			tracker.current = createTracker(current, { nonce: currentNonce, loadScript: currentLoad })
		}
		return tracker.current
	}, [])

	useEffect(() => {
		ensure()
		return () => {
			tracker.current?.destroy()
			tracker.current = null
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
