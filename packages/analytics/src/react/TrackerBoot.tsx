'use client'

import type { TrackerConfig } from '../capture/trackerConfig'

export interface TrackerBootProps {
	config: TrackerConfig
	/** CSP nonce for any script this component injects. */
	nonce?: string
}

/**
 * Boots the browser tracker from a server-resolved config. Placeholder: renders nothing
 * until the tracker package lands and fills it in.
 */
export const TrackerBoot = (_props: TrackerBootProps): null => null
