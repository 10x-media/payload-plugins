import type { CaptureSlot, TrackerSlotConfig } from './config'
import { writeStorage } from './storage'
import type { GateState, GateStatus, TrackerEvent, TrackerWindow } from './types'

/**
 * How many events one slot holds while its gate is pending before the oldest is dropped: a
 * visitor who never answers the banner must not grow the tab's memory without bound.
 */
export const GATE_QUEUE_LIMIT = 100

/**
 * Where 1.0.0-beta.11 persisted the consent decision. The tracker deletes it once a slot opens, for
 * the whole 1.x line: a stale decision must never outlive the host's own answer.
 */
export const LEGACY_CONSENT_KEYS = ['analytics:consent'] as const

/** Every capture slot, in slot order. Kept here because `/tracker` cannot load `capture/slots`. */
export const GATE_SLOTS: readonly CaptureSlot[] = ['global', 'tenant']

export type GateSnapshot = Readonly<Record<CaptureSlot, GateStatus>>

/** The snapshot of a window with no tracker and no answer yet, and of the server render. */
export const ALL_PENDING: GateSnapshot = Object.freeze({ global: 'pending', tenant: 'pending' })

/** Deletes beta.11's consent key. Blocked storage holds none to delete. */
export const forgetLegacyConsent = (win: TrackerWindow): void => {
	for (const key of LEGACY_CONSENT_KEYS) {
		writeStorage(win, key, null)
	}
}

/** The config filling `slot`, if any. */
export const slotConfigOf = (
	slots: readonly TrackerSlotConfig[],
	slot: CaptureSlot
): TrackerSlotConfig | undefined => slots.find((candidate) => candidate.slot === slot)

/**
 * Whether `capture.gate` holds a slot. A config cached from 1.0.0-beta.11 carries
 * `requiresConsent` instead, and one carrying neither is held: a slot fails closed.
 */
export const slotIsGated = (slot: TrackerSlotConfig): boolean => {
	if (typeof slot.gated === 'boolean') {
		return slot.gated
	}
	const legacy: unknown = Reflect.get(slot, 'requiresConsent')
	return typeof legacy === 'boolean' ? legacy : true
}

/**
 * What one answer says about one slot: a boolean answers for the held slots alone, a record for
 * the slots it names. Undefined leaves the slot's gate as it is.
 */
export const gateAnswer = (
	state: GateState | undefined,
	slot: CaptureSlot,
	gated: boolean
): boolean | undefined => {
	if (state === undefined) {
		return undefined
	}
	if (typeof state === 'boolean') {
		return gated ? state : undefined
	}
	return state[slot]
}

/** Whether a slot's gate is open as the page boots: the server's answer, else open unless held. */
export const openAtBoot = (slot: TrackerSlotConfig, state: GateState | undefined): boolean => {
	const gated = slotIsGated(slot)
	return gateAnswer(state, slot.slot, gated) ?? !gated
}

/**
 * Adds an answer to a window's collected ones, keeping the latest boolean and each slot's latest
 * named answer: replayed in order, they settle every slot as the full history would.
 */
export const appendGateAnswer = (answers: readonly GateState[], state: GateState): GateState[] => {
	if (typeof state === 'boolean') {
		return [...answers.filter((answer) => typeof answer !== 'boolean'), state]
	}
	const named = GATE_SLOTS.filter((slot) => state[slot] !== undefined)
	const kept = answers.filter(
		(answer) => typeof answer === 'boolean' || !named.some((slot) => answer[slot] !== undefined)
	)
	return [...kept, ...named.map((slot) => ({ [slot]: state[slot] }))]
}

/**
 * Folds answers given in order into the one a tracker boots with, for the slots `slots` holds or
 * not: the latest answer that speaks for each slot. Undefined when none speaks for any.
 */
export const settleGateAnswers = (
	slots: readonly TrackerSlotConfig[],
	answers: readonly GateState[]
): GateState | undefined => {
	const settled: Partial<Record<CaptureSlot, boolean>> = {}
	let any = false
	for (const slot of GATE_SLOTS) {
		const config = slotConfigOf(slots, slot)
		const gated = config ? slotIsGated(config) : true
		for (const answer of answers) {
			const open = gateAnswer(answer, slot, gated)
			if (open !== undefined) {
				settled[slot] = open
				any = true
			}
		}
	}
	return any ? settled : undefined
}

/**
 * What one slot's gate says once `answers` are replayed over it: `gated` holds it pending until an
 * answer speaks for it, and an ungated slot starts open and moves only by name.
 */
const replayed = (answers: readonly GateState[], slot: CaptureSlot, gated: boolean): GateStatus => {
	let status: GateStatus = gated ? 'pending' : 'open'
	for (const answer of answers) {
		const open = gateAnswer(answer, slot, gated)
		if (open !== undefined) {
			status = open ? 'open' : 'closed'
		}
	}
	return status
}

/**
 * The gate a window's answers describe, exactly a booting tracker's once `slots` is known. Before
 * that, a slot where held and ungated readings disagree is pending.
 */
export const answeredSnapshot = (
	answers: readonly GateState[],
	slots?: readonly TrackerSlotConfig[]
): GateSnapshot => {
	if (slots !== undefined) {
		const gate = createGate(slots)
		for (const answer of answers) {
			gate.answer(answer)
		}
		return gate.snapshot
	}
	const status = (slot: CaptureSlot): GateStatus => {
		const held = replayed(answers, slot, true)
		return held === replayed(answers, slot, false) ? held : 'pending'
	}
	return Object.freeze({ global: status('global'), tenant: status('tenant') })
}

/**
 * What may wait in a pending slot's queue: an engagement only for a native slot, since a vendor
 * drops one, and never the items seen, which count only while a slot may receive them.
 */
export const queueable = (
	event: TrackerEvent,
	kind: TrackerSlotConfig['kind']
): TrackerEvent | null => {
	if (event.type === 'engagement' && kind !== 'native') {
		return null
	}
	if (event.impressions === undefined) {
		return event
	}
	const { impressions: _impressions, ...rest } = event
	return rest.type === 'engagement' && !rest.durationMs && !rest.scrollDepth ? null : rest
}

export interface GateQueue<T> {
	push(item: T): void
	drain(): T[]
	clear(): void
	readonly size: number
}

/** Bounded FIFO buffer holding one slot's events while its gate is pending. */
export const createGateQueue = <T>(limit: number = GATE_QUEUE_LIMIT): GateQueue<T> => {
	let items: T[] = []
	return {
		push(item) {
			items.push(item)
			if (items.length > limit) {
				items.splice(0, items.length - limit)
			}
		},
		drain() {
			const drained = items
			items = []
			return drained
		},
		clear() {
			items = []
		},
		get size() {
			return items.length
		},
	}
}

/** A slot an answer opened or closed, for the tracker to act on, and the status it left. */
export interface GateTransition {
	slot: CaptureSlot
	from: GateStatus
	to: 'open' | 'closed'
}

export interface Gate {
	status(slot: CaptureSlot): GateStatus
	/** Frozen, and the same object until a slot's gate changes. */
	readonly snapshot: GateSnapshot
	/**
	 * Applies one answer and returns the slots it moved. A slot's first explicit `true` counts as
	 * opening even when already open, so a held-open slot clears a refusal from an earlier page.
	 */
	answer(state: GateState): GateTransition[]
	/** Puts every held slot back to pending and forgets its answers. Says whether one moved. */
	reset(): boolean
}

/**
 * The gate's side-effect-free state machine: a held slot starts pending, others open, and a slot the
 * config does not fill stays closed, since no answer could make it capture anything.
 */
export const createGate = (slots: readonly TrackerSlotConfig[]): Gate => {
	const initial = (slot: CaptureSlot): GateStatus => {
		const config = slotConfigOf(slots, slot)
		if (config === undefined) {
			return 'closed'
		}
		return slotIsGated(config) ? 'pending' : 'open'
	}
	const statuses: Record<CaptureSlot, GateStatus> = {
		global: initial('global'),
		tenant: initial('tenant'),
	}
	const answered = new Set<CaptureSlot>()
	let snapshot: GateSnapshot = Object.freeze({ ...statuses })
	return {
		status: (slot) => statuses[slot],
		get snapshot() {
			return snapshot
		},
		answer(state) {
			const moved: GateTransition[] = []
			let changed = false
			for (const slot of GATE_SLOTS) {
				const config = slotConfigOf(slots, slot)
				const open = config && gateAnswer(state, slot, slotIsGated(config))
				if (open === undefined) {
					continue
				}
				const to = open ? 'open' : 'closed'
				const from = statuses[slot]
				if (from === to && answered.has(slot)) {
					continue
				}
				answered.add(slot)
				changed ||= from !== to
				statuses[slot] = to
				moved.push({ slot, from, to })
			}
			if (changed) {
				snapshot = Object.freeze({ ...statuses })
			}
			return moved
		},
		reset() {
			let changed = false
			for (const slot of GATE_SLOTS) {
				const config = slotConfigOf(slots, slot)
				if (config === undefined || !slotIsGated(config)) {
					continue
				}
				answered.delete(slot)
				changed ||= statuses[slot] !== 'pending'
				statuses[slot] = 'pending'
			}
			if (changed) {
				snapshot = Object.freeze({ ...statuses })
			}
			return changed
		},
	}
}
