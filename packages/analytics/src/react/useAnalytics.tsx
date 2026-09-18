'use client'

import { useContext, useMemo, useSyncExternalStore } from 'react'
import { readExclusion, subscribeExclusion } from '../tracker/exclusion'
import { liveTracker } from '../tracker/registry'
import type { Tracker } from '../tracker/types'
import { type AnalyticsApi, type AnalyticsCommands, AnalyticsContext } from './AnalyticsProvider'

const NO_TRACKER =
	'analytics: useAnalytics found no tracker. Render <AnalyticsScripts /> (or <AnalyticsProvider>) above this component.'

/** The live tracker's flag, so a blocked storage still reports this page's exclusion. */
const exclusionSnapshot = (): boolean => {
	if (typeof window === 'undefined') {
		return false
	}
	return liveTracker(window)?.excluded ?? readExclusion(window)
}

const serverSnapshot = (): boolean => false

/**
 * The window's tracker: the surrounding `<AnalyticsProvider>`'s when there is one, else
 * whichever instance `<AnalyticsScripts />` booted, so the RSC path alone is enough for a
 * client component to send its own events.
 *
 * The tracker is resolved per call, not per render: `<TrackerBoot />`'s effect may not have
 * run when a sibling renders, and an eagerly resolved null would never recover. A call that
 * finds neither a provider nor a booted tracker throws, because a silently dead `track` is
 * worse than a build-time mistake.
 *
 * `excluded` is read from the tracker rather than held in state, so every component sees the
 * same flag however it was flipped.
 */
export const useAnalytics = (): AnalyticsApi => {
	const provided = useContext(AnalyticsContext)
	const excluded = useSyncExternalStore(subscribeExclusion, exclusionSnapshot, serverSnapshot)
	const commands = useMemo<AnalyticsCommands>(() => {
		if (provided) {
			return provided
		}
		const tracker = (): Tracker => {
			const live = liveTracker()
			if (!live) {
				throw new Error(NO_TRACKER)
			}
			return live
		}
		return {
			track: (name, props) => tracker().track(name, props),
			trackGoal: (slug, opts) => tracker().trackGoal(slug, opts),
			consent: (state) => tracker().consent(state),
			setExcluded: (next) => tracker().exclude(next),
		}
	}, [provided])

	return useMemo<AnalyticsApi>(() => ({ ...commands, excluded }), [commands, excluded])
}
