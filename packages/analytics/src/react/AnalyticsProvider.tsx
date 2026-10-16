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
import type { CaptureSlot, TrackerConfig } from '../tracker/config'
import type { ModeSnapshot } from '../tracker/gate'
import { acquireTracker, setWindowGate, type TrackerLease } from '../tracker/registry'
import type { GateState, GateStatus, LoadScript, Tracker } from '../tracker/types'

/** What a component can ask the tracker to do. Stable for the life of the provider. */
export interface AnalyticsCommands {
	track: Tracker['track']
	trackGoal: Tracker['trackGoal']
	/** Records a sale, with the amount that actually moved rather than the goal's own. */
	purchase: Tracker['purchase']
	/** A no-op in the browser, with a development warning: refunds are server-side. */
	refund: Tracker['refund']
	/**
	 * Opens or closes capture slots for the host's consent manager. Safe before the tracker has
	 * booted: the answer is kept for the window and applied at boot.
	 */
	setGate: (state: GateState) => void
	/** Takes this browser out of capture, or puts it back. */
	setExcluded: Tracker['exclude']
}

/** The tracker surface a component gets from `useAnalytics`. */
export interface AnalyticsApi extends AnalyticsCommands {
	/** True while this browser is excluded from capture. Flipping it re-renders the caller. */
	excluded: boolean
	/** Each capture slot's gate. A change re-renders the caller. */
	gate: Readonly<Record<CaptureSlot, GateStatus>>
	/**
	 * What each capture slot captures with: `full` once open, else its level without consent (`off`,
	 * `cookieless`, `anonymous`). All `off` until a tracker booted. A change re-renders the caller.
	 */
	mode: ModeSnapshot
}

export const AnalyticsContext = createContext<AnalyticsCommands | null>(null)

export interface AnalyticsProviderProps {
	/** Resolved server-side by `getTrackerConfig`, or fetched from the tracker endpoint. */
	config: TrackerConfig
	children?: ReactNode
	/** CSP nonce applied to the vendor scripts the tracker injects. */
	nonce?: string
	/**
	 * Replaces script injection, for a framework script loader. A function cannot cross from a
	 * server component, so pass it from a client component of your own.
	 */
	loadScript?: LoadScript
	/** The answer the host already has at boot, as `<AnalyticsScripts gate>` takes it. */
	gate?: GateState
	/** `false` injects no vendor script at all, for a consent manager that loads them itself. */
	snippets?: boolean
}

/**
 * Shares the window's one tracker with the tree through `useAnalytics`, leased after mount. The
 * first component to boot it owns its options: after `<AnalyticsScripts />`, this one's are ignored.
 */
export const AnalyticsProvider = ({
	config,
	children,
	nonce,
	loadScript,
	gate,
	snippets,
}: AnalyticsProviderProps): ReactElement => {
	const boot = useRef({ config, nonce, loadScript, gate, snippets })
	boot.current = { config, nonce, loadScript, gate, snippets }
	const lease = useRef<TrackerLease | null>(null)
	const unmounted = useRef(false)

	const ensure = useCallback((): Tracker | null => {
		if (!lease.current && !unmounted.current && typeof window !== 'undefined') {
			const current = boot.current
			lease.current = acquireTracker(current.config, {
				nonce: current.nonce,
				loadScript: current.loadScript,
				gate: current.gate,
				snippets: current.snippets,
			})
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

	const api = useMemo<AnalyticsCommands>(
		() => ({
			track: (name, props, opts) => ensure()?.track(name, props, opts),
			trackGoal: (slug, opts) => ensure()?.trackGoal(slug, opts),
			purchase: (input) => ensure()?.purchase(input),
			refund: (input) => ensure()?.refund(input),
			// Recorded before the boot, which a child's effect can trigger ahead of the provider's own:
			// a tracker booted first would load and send under the previous answer.
			setGate: (state) => {
				setWindowGate(state)
				ensure()
			},
			setExcluded: (next) => ensure()?.exclude(next),
		}),
		[ensure]
	)

	return <AnalyticsContext.Provider value={api}>{children}</AnalyticsContext.Provider>
}
