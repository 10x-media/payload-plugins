'use client'

import { useContext, useMemo, useSyncExternalStore } from 'react'
import { subscribeExclusion } from '../tracker/exclusion'
import { ALL_OFF, ALL_PENDING, type GateSnapshot, type ModeSnapshot } from '../tracker/gate'
import {
	liveTracker,
	setWindowGate,
	subscribeWindowGate,
	windowGateSnapshot,
	windowModeSnapshot,
} from '../tracker/registry'
import type { Tracker } from '../tracker/types'
import { type AnalyticsApi, type AnalyticsCommands, AnalyticsContext } from './AnalyticsProvider'

const NO_TRACKER =
	'analytics: useAnalytics found no tracker. Render <AnalyticsScripts /> (or <AnalyticsProvider>) above this component.'

/** The live tracker's flag, never storage: false until a tracker has read it, once a slot ran in full. */
const exclusionSnapshot = (): boolean => liveTracker()?.excluded ?? false

const serverExclusionSnapshot = (): boolean => false

const serverGateSnapshot = (): GateSnapshot => ALL_PENDING

const serverModeSnapshot = (): ModeSnapshot => ALL_OFF

/**
 * The window's tracker, from `<AnalyticsProvider>` or else whatever `<AnalyticsScripts />` booted.
 * A call with neither throws, except `setGate`, which is kept until a tracker boots.
 */
export const useAnalytics = (): AnalyticsApi => {
	const provided = useContext(AnalyticsContext)
	const excluded = useSyncExternalStore(
		subscribeExclusion,
		exclusionSnapshot,
		serverExclusionSnapshot
	)
	const gate = useSyncExternalStore(subscribeWindowGate, windowGateSnapshot, serverGateSnapshot)
	const mode = useSyncExternalStore(subscribeWindowGate, windowModeSnapshot, serverModeSnapshot)
	const commands = useMemo<AnalyticsCommands>(() => {
		if (provided) {
			return provided
		}
		// Per call, not per render: the boot effect may not have run yet when a sibling renders.
		const tracker = (): Tracker => {
			const live = liveTracker()
			if (!live) {
				throw new Error(NO_TRACKER)
			}
			return live
		}
		return {
			track: (name, props, opts) => tracker().track(name, props, opts),
			trackGoal: (slug, opts) => tracker().trackGoal(slug, opts),
			purchase: (input) => tracker().purchase(input),
			refund: (input) => tracker().refund(input),
			setGate: (state) => setWindowGate(state),
			setExcluded: (next) => tracker().exclude(next),
		}
	}, [provided])

	return useMemo<AnalyticsApi>(
		() => ({ ...commands, excluded, gate, mode }),
		[commands, excluded, gate, mode]
	)
}
