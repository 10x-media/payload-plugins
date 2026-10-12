import { DEFAULT_ROUTE_BASE, routePaths } from '../plugin/routes'
import type { TrackerConfig } from './config'
import { createNoopTracker } from './createTracker'
import { acquireTracker, leasedTracker } from './registry'
import type { Tracker, TrackerOptions, TrackerWindow } from './types'
import { currentWindow } from './window'

/**
 * The public tracker config on a default install. An app that moved `routes.api` or `routes.base`,
 * or serves under a Next `basePath`, passes `endpoint`: this bundle runs on pages Next never built.
 */
export const DEFAULT_TRACKER_ENDPOINT = `/api${routePaths(DEFAULT_ROUTE_BASE).config}`

export interface InitTrackerArgs extends TrackerOptions {
	endpoint?: string
}

/** Each window's config requests still in flight, by endpoint. */
const inFlight = new WeakMap<TrackerWindow, Map<string, Promise<TrackerConfig | null>>>()

/**
 * The config at `endpoint`, or null when unreachable. Concurrent calls share one request, so
 * StrictMode's second mount leases the first mount's tracker instead of booting another.
 */
const fetchConfig = (win: TrackerWindow, endpoint: string): Promise<TrackerConfig | null> => {
	let pending = inFlight.get(win)
	if (!pending) {
		pending = new Map()
		inFlight.set(win, pending)
	}
	const shared = pending.get(endpoint)
	if (shared) {
		return shared
	}
	const requests = pending
	const request = (async (): Promise<TrackerConfig | null> => {
		try {
			const response = await win.fetch(endpoint, { credentials: 'same-origin' })
			// Unchecked: a malformed body throws in the boot, which falls back to the no-op tracker.
			return response.ok ? ((await response.json()) as TrackerConfig) : null
		} catch {
			return null
		} finally {
			requests.delete(endpoint)
		}
	})()
	requests.set(endpoint, request)
	return request
}

/**
 * Boots the window's shared tracker from the public config endpoint, for pages without RSC or
 * rendered statically. Never rejects: no config yields a no-op; `destroy` releases this call's hold.
 */
export const initTracker = async (args: InitTrackerArgs = {}): Promise<Tracker> => {
	const { endpoint = DEFAULT_TRACKER_ENDPOINT, ...options } = args
	const win = currentWindow(options.window)
	if (!win) {
		return createNoopTracker()
	}
	const config = await fetchConfig(win, endpoint)
	if (config === null) {
		return createNoopTracker()
	}
	try {
		return leasedTracker(acquireTracker(config, { ...options, window: win }), win)
	} catch {
		return createNoopTracker()
	}
}
