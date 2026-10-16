import type { TrackerConfig, TrackerSlotConfig } from './config'
import { createNoopTracker, createTracker, restoreGate } from './createTracker'
import {
	ALL_OFF,
	ALL_PENDING,
	answeredModes,
	answeredSnapshot,
	appendGateAnswer,
	GATE_SLOTS,
	type GateSnapshot,
	type ModeSnapshot,
	settleGateAnswers,
	slotConfigOf,
	slotIsGated,
} from './gate'
import type { GateState, Tracker, TrackerOptions, TrackerWindow } from './types'
import { currentWindow } from './window'

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

/**
 * The gate answers a window has been given, for as long as the page lives: a tracker booted
 * after them, or booted again after a remount, starts from them rather than from pending.
 */
interface WindowGate {
	answers: GateState[]
	/** What the answers say while no tracker holds the window. */
	answered: GateSnapshot
	/** The modes they give while no tracker holds the window, all off before a config is known. */
	answeredModes: ModeSnapshot
	/** The slots of the config the window last booted a tracker with, which say which are held. */
	slots?: readonly TrackerSlotConfig[]
	listeners: Set<() => void>
	/** Takes the window's back/forward cache listener off. */
	detach: () => void
}

const entries = new WeakMap<TrackerWindow, Entry>()

const gates = new WeakMap<TrackerWindow, WindowGate>()

const notify = (win: TrackerWindow): void => {
	for (const listener of gates.get(win)?.listeners ?? []) {
		listener()
	}
}

/** Replaces the window's answers, and what they say while no tracker holds the window. */
const keepAnswers = (kept: WindowGate, answers: GateState[]): void => {
	kept.answers = answers
	kept.answered = answeredSnapshot(answers, kept.slots)
	kept.answeredModes = answeredModes(answers, kept.slots)
}

/** Whether an answer names ungated slots alone, which a restored page keeps answered. */
const namesUngatedOnly = (
	answer: GateState,
	slots: readonly TrackerSlotConfig[] | undefined
): boolean => {
	if (typeof answer === 'boolean' || slots === undefined) {
		return false
	}
	return GATE_SLOTS.every((slot) => {
		const config = slotConfigOf(slots, slot)
		return answer[slot] === undefined || (config !== undefined && !slotIsGated(config))
	})
}

const windowGate = (win: TrackerWindow): WindowGate => {
	const existing = gates.get(win)
	if (existing) {
		return existing
	}
	// A restored page waits for the host to answer for its held slots again, as a new load would.
	const onPageShow = (event: PageTransitionEvent) => {
		const restored = gates.get(win)
		if (!event.persisted || !restored) {
			return
		}
		keepAnswers(
			restored,
			restored.answers.filter((answer) => namesUngatedOnly(answer, restored.slots))
		)
		const tracker = entries.get(win)?.tracker
		if (tracker) {
			restoreGate(tracker, event)
		}
		notify(win)
	}
	win.addEventListener('pageshow', onPageShow)
	const kept: WindowGate = {
		answers: [],
		answered: ALL_PENDING,
		answeredModes: ALL_OFF,
		listeners: new Set(),
		detach: () => win.removeEventListener('pageshow', onPageShow),
	}
	gates.set(win, kept)
	return kept
}

/**
 * The tracker a window already holds, or null: a peek that takes no lease, for callers with no
 * config of their own such as `useAnalytics` outside a provider.
 */
export const liveTracker = (window?: TrackerWindow): Tracker | null => {
	const win = currentWindow(window)
	return win ? (entries.get(win)?.tracker ?? null) : null
}

/**
 * Answers the window's gate: kept for every tracker the page boots and applied to the current one,
 * so a consent bridge may answer before any tracker exists.
 */
export const setWindowGate = (state: GateState, window?: TrackerWindow): void => {
	const win = currentWindow(window)
	if (!win) {
		return
	}
	const kept = windowGate(win)
	keepAnswers(kept, appendGateAnswer(kept.answers, state))
	entries.get(win)?.tracker.setGate(state)
	notify(win)
}

/** The window's gate: its tracker's, else what the answers given so far say. */
export const windowGateSnapshot = (window?: TrackerWindow): GateSnapshot => {
	const win = currentWindow(window)
	if (!win) {
		return ALL_PENDING
	}
	return entries.get(win)?.tracker.gate ?? gates.get(win)?.answered ?? ALL_PENDING
}

/** The window's slot modes: its tracker's, else what the answers given so far give its last config. */
export const windowModeSnapshot = (window?: TrackerWindow): ModeSnapshot => {
	const win = currentWindow(window)
	if (!win) {
		return ALL_OFF
	}
	return entries.get(win)?.tracker.mode ?? gates.get(win)?.answeredModes ?? ALL_OFF
}

/** Calls `listener` whenever the window's gate or modes may have changed. Returns the unsubscribe. */
export const subscribeWindowGate = (listener: () => void, window?: TrackerWindow): (() => void) => {
	const win = currentWindow(window)
	if (!win) {
		return () => undefined
	}
	const { listeners } = windowGate(win)
	listeners.add(listener)
	return () => {
		listeners.delete(listener)
	}
}

/** Forgets the window's gate answers. For tests, which share one window across cases. */
export const forgetWindowGate = (window?: TrackerWindow): void => {
	const win = currentWindow(window)
	if (win) {
		gates.get(win)?.detach()
		gates.delete(win)
	}
}

/**
 * The lease's tracker for a sole holder: `destroy` returns the lease instead of ending a shared
 * tracker, and `setGate` answers for the window so a later boot starts from that answer.
 */
export const leasedTracker = (lease: TrackerLease, window?: TrackerWindow): Tracker => {
	const { tracker } = lease
	return {
		page: () => tracker.page(),
		track: (name, props, opts) => tracker.track(name, props, opts),
		trackGoal: (slug, opts) => tracker.trackGoal(slug, opts),
		purchase: (input) => tracker.purchase(input),
		refund: (input) => tracker.refund(input),
		setGate: (state) => setWindowGate(state, window),
		get gate() {
			return tracker.gate
		},
		get mode() {
			return tracker.mode
		},
		get excluded() {
			return tracker.excluded
		},
		exclude: (next) => tracker.exclude(next),
		flush: () => tracker.flush(),
		destroy: () => lease.release(),
	}
}

/**
 * Hands out the window's one tracker, reference counted, so StrictMode remounts and sibling
 * components share it. The first holder's config wins; the window's gate answers outrank `gate`.
 */
export const acquireTracker = (
	config: TrackerConfig,
	options: TrackerOptions = {}
): TrackerLease => {
	const win = currentWindow(options.window)
	if (!win) {
		return { tracker: createNoopTracker(), release: () => undefined }
	}
	let entry = entries.get(win)
	if (!entry) {
		const kept = windowGate(win)
		const gate = settleGateAnswers(config.slots, [
			...(options.gate === undefined ? [] : [options.gate]),
			...kept.answers,
		])
		kept.slots = config.slots
		keepAnswers(kept, kept.answers)
		entry = {
			tracker: createTracker(config, { ...options, window: win, gate }),
			refs: 0,
			teardown: null,
		}
		entries.set(win, entry)
		notify(win)
	}
	if (entry.teardown !== null) {
		win.clearTimeout(entry.teardown)
		entry.teardown = null
	}
	entry.refs += 1
	const leased = entry
	let released = false

	return {
		tracker: entry.tracker,
		release() {
			if (released) {
				return
			}
			released = true
			leased.refs -= 1
			if (leased.refs > 0 || leased.teardown !== null) {
				return
			}
			leased.teardown = win.setTimeout(() => {
				leased.teardown = null
				if (leased.refs > 0) {
					return
				}
				leased.tracker.destroy()
				if (entries.get(win) === leased) {
					entries.delete(win)
					notify(win)
				}
			}, 0)
		},
	}
}
