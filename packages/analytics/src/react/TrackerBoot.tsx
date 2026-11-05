'use client'

import { useEffect, useRef } from 'react'
import type { TrackerConfig } from '../tracker/config'
import { acquireTracker } from '../tracker/registry'
import type { GateState } from '../tracker/types'

export interface TrackerBootProps {
	config: TrackerConfig
	/** CSP nonce for any script the tracker injects. */
	nonce?: string
	/** The answer the server rendered the page with, applied at boot. */
	gate?: GateState
	/** `false` injects no vendor script at all. */
	snippets?: boolean
}

/**
 * Internal: what `<AnalyticsScripts />` renders to boot the tracker with server-passable props. It
 * leases the window's one tracker, so it and `<AnalyticsProvider>` never double-count.
 */
export const TrackerBoot = ({ config, nonce, gate, snippets }: TrackerBootProps): null => {
	const boot = useRef({ config, nonce, gate, snippets })
	boot.current = { config, nonce, gate, snippets }

	useEffect(() => {
		const current = boot.current
		const lease = acquireTracker(current.config, {
			nonce: current.nonce,
			gate: current.gate,
			snippets: current.snippets,
		})
		return () => lease.release()
	}, [])

	return null
}
