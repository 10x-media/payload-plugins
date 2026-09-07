'use client'

import { useEffect, useRef } from 'react'
import type { TrackerConfig } from '../capture/trackerConfig'
import { createTracker } from '../tracker/createTracker'

export interface TrackerBootProps {
	config: TrackerConfig
	/** CSP nonce for any script this component injects. */
	nonce?: string
}

/**
 * Boots the browser tracker from a server-resolved config and renders nothing. This is the
 * RSC path: `<AnalyticsScripts />` renders it after the slot snippets, so a page gets
 * pageviews and auto-capture with no provider and no client state. Wrap the tree in
 * `<AnalyticsProvider>` instead when components need to call `track` themselves; rendering
 * both would boot two trackers.
 */
export const TrackerBoot = ({ config, nonce }: TrackerBootProps): null => {
	const boot = useRef({ config, nonce })
	boot.current = { config, nonce }

	useEffect(() => {
		const tracker = createTracker(boot.current.config, { nonce: boot.current.nonce })
		return () => tracker.destroy()
	}, [])

	return null
}
