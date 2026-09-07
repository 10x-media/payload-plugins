'use client'

import { useEffect, useRef } from 'react'
import type { TrackerConfig } from '../capture/trackerConfig'
import { acquireTracker } from '../tracker/registry'

export interface TrackerBootProps {
	config: TrackerConfig
	/** CSP nonce for any script this component injects. */
	nonce?: string
}

/**
 * Boots the browser tracker from a server-resolved config and renders nothing. This is the
 * RSC path: `<AnalyticsScripts />` renders it after the slot snippets, so a page gets
 * pageviews and auto-capture with no provider and no client state. Wrap the tree in
 * `<AnalyticsProvider>` as well when components need to call `track` themselves: both take
 * a lease on the window's one tracker, so neither double-counts.
 */
export const TrackerBoot = ({ config, nonce }: TrackerBootProps): null => {
	const boot = useRef({ config, nonce })
	boot.current = { config, nonce }

	useEffect(() => {
		const lease = acquireTracker(boot.current.config, { nonce: boot.current.nonce })
		return () => lease.release()
	}, [])

	return null
}
