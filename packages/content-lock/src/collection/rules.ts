import { statusOf } from '../state/resolve'
import type { LockWindow } from '../state/types'
import { keys, type TranslationKey } from '../translations/keys'

/** A rule broken by a proposed change, as the translation key explaining it. */
export type RuleViolation = TranslationKey

/**
 * Check a proposed window against the editing rules. `before` is the stored
 * window (absent on create), `after` the window as it would be saved.
 * Returns the first broken rule, or `null`.
 */
export const checkWindowChange = (
	before: LockWindow | null,
	after: LockWindow,
	now: Date
): RuleViolation | null => {
	if (before) {
		const status = statusOf(before, now)
		if (status === 'ended') {
			return keys.errorEndedReadOnly
		}
		if (status === 'active' && Date.parse(after.startsAt) > now.getTime()) {
			return keys.errorActiveStartMoved
		}
	}
	const startsAt = Date.parse(after.startsAt)
	if (after.announceAt !== null && Date.parse(after.announceAt) > startsAt) {
		return keys.errorAnnounceAfterStart
	}
	if (after.endMode === 'at') {
		if (after.endsAt === null) {
			return keys.errorEndsAtRequired
		}
		if (Date.parse(after.endsAt) <= startsAt) {
			return keys.errorEndBeforeStart
		}
	}
	if (after.scope === 'selected' && after.targets.length === 0) {
		return keys.errorTargetsRequired
	}
	return null
}
