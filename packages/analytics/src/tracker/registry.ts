import type { TrackerConfig } from '../capture/trackerConfig'
import { createNoopTracker, createTracker } from './createTracker'
import type { Tracker, TrackerOptions, TrackerWindow } from './types'

export interface TrackerLease {
	tracker: Tracker
	/** Gives up this holder's claim. Safe to call more than once. */
	release(): void
}

interface Entry {
	tracker: Tracker
	refs: number
	teardown: ReturnType<Window['setTimeout']> | null
}

const entries = new WeakMap<TrackerWindow, Entry>()

/**
 * Hands out the one tracker a window is allowed to have, reference counted.
 *
 * React mounts an effect, tears it down, and mounts it again on the same commit under
 * StrictMode, so a component that created a tracker in its effect booted two of them and
 * sent two boot pageviews. Here the second mount finds the live instance instead. The
 * teardown is deferred to a macrotask and skipped if a new holder arrived in the meantime,
 * which is what makes that synchronous remount free; a real unmount still destroys the
 * tracker on the next tick.
 *
 * One tracker per window also means `<AnalyticsScripts />` and `<AnalyticsProvider>` can
 * both be rendered without double-counting. The first holder's config wins for as long as
 * the tracker lives.
 */
export const acquireTracker = (
	config: TrackerConfig,
	options: TrackerOptions = {}
): TrackerLease => {
	const win = options.window ?? (globalThis as { window?: TrackerWindow }).window
	if (!win) {
		return { tracker: createNoopTracker(), release: () => undefined }
	}
	let entry = entries.get(win)
	if (!entry) {
		entry = {
			tracker: createTracker(config, { ...options, window: win }),
			refs: 0,
			teardown: null,
		}
		entries.set(win, entry)
	}
	if (entry.teardown !== null) {
		win.clearTimeout(entry.teardown)
		entry.teardown = null
	}
	entry.refs += 1
	const held = entry
	let released = false

	return {
		tracker: entry.tracker,
		release() {
			if (released) {
				return
			}
			released = true
			held.refs -= 1
			if (held.refs > 0 || held.teardown !== null) {
				return
			}
			held.teardown = win.setTimeout(() => {
				held.teardown = null
				if (held.refs > 0) {
					return
				}
				held.tracker.destroy()
				if (entries.get(win) === held) {
					entries.delete(win)
				}
			}, 0)
		},
	}
}
