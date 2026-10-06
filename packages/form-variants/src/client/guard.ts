export type SaveGuardArgs = {
	/** The reason a step gave `blockSave()`, or `null`. */
	blockedMessage: null | string
	/** Whether the wizard has ended with an outcome, after which nothing may be saved again. */
	finished: boolean
	isLast: boolean
	readOnly: boolean
	save: 'always' | 'final-step'
}

export type SaveGuardResult = {
	allowed: boolean
	reason: 'blocked' | 'finished' | 'not-final-step' | 'read-only' | null
}

/**
 * The one save guard. A save is allowed only when the document is not read-only, the wizard
 * has not ended with an outcome, no step has blocked saving, and the policy is `always` or the
 * user is on the last visible step. A draft save answers to it as a publish does: the step that
 * blocked saving blocked writing the document at all.
 */
export const computeSaveGuard = (args: SaveGuardArgs): SaveGuardResult => {
	if (args.readOnly) {
		return { allowed: false, reason: 'read-only' }
	}
	if (args.finished) {
		return { allowed: false, reason: 'finished' }
	}
	if (args.blockedMessage !== null) {
		return { allowed: false, reason: 'blocked' }
	}
	if (args.save === 'final-step' && !args.isLast) {
		return { allowed: false, reason: 'not-final-step' }
	}
	return { allowed: true, reason: null }
}
