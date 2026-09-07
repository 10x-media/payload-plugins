import type { TrackerConfig } from '../capture/trackerConfig'
import { createNoopTracker, createTracker } from './createTracker'
import type { Tracker, TrackerOptions, TrackerWindow } from './types'

/**
 * Where the plugin mounts the public tracker config on a default install. The only place
 * the path is written down on the client: the RSC path hands the config over directly, and
 * an app that moved `routes.api` passes its own `endpoint`.
 */
export const DEFAULT_TRACKER_ENDPOINT = '/api/analytics/tracker'

export interface InitTrackerArgs extends TrackerOptions {
	endpoint?: string
}

/**
 * Boots the tracker from the public tracker endpoint, for hosts that render no RSC. The
 * request is same-origin so a scoped install resolves the visitor's tenant from the request
 * itself. A config that cannot be fetched yields a tracker that does nothing rather than a
 * rejected promise: a missing analytics config must never break the page that awaited it.
 */
export const initTracker = async (args: InitTrackerArgs = {}): Promise<Tracker> => {
	const { endpoint = DEFAULT_TRACKER_ENDPOINT, ...options } = args
	const win = options.window ?? (globalThis as { window?: TrackerWindow }).window
	if (!win) {
		return createNoopTracker()
	}
	try {
		const response = await win.fetch(endpoint, { credentials: 'same-origin' })
		if (!response.ok) {
			return createNoopTracker()
		}
		return createTracker((await response.json()) as TrackerConfig, { ...options, window: win })
	} catch {
		return createNoopTracker()
	}
}
