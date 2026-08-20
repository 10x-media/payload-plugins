/**
 * Intent state machine for the write-only editor, kept pure so every
 * transition is unit-testable. A write-only form value means:
 *
 *   undefined  keep the stored value (concealed face shows dots/hint)
 *   null       clear the stored value on save ("will be removed" face)
 *   string     replace the stored value with this plaintext (visible)
 *
 * `cleared` is the lineage flag: it survives typing, so erasing a half-typed
 * replacement returns the field to the state the user was in when they
 * started typing (keep, or their explicitly chosen clear), never silently
 * cancelling a clear.
 */

export interface WriteOnlyOutcome {
	cleared: boolean
	value: null | number | string | undefined
}

export interface InputContext {
	cleared: boolean
	isNumber: boolean
}

/** The staged form value after the input's text changes. */
export const applyInput = (text: string, { cleared, isNumber }: InputContext): WriteOnlyOutcome => {
	if (text === '') {
		// Emptied input returns to the lineage state: a prior explicit clear
		// stays a clear; otherwise the stored value stays kept.
		return { cleared, value: cleared ? null : undefined }
	}
	if (isNumber) {
		const parsed = Number.parseFloat(text)
		return { cleared, value: Number.isNaN(parsed) ? (cleared ? null : undefined) : parsed }
	}
	return { cleared, value: text }
}

export interface ClearContext {
	cleared: boolean
	clearable: boolean
	isSet: boolean
	typed: boolean
}

/**
 * The × action clears what is "in" the control: staged text first (returning
 * to the lineage state), then the stored value (entering the undoable cleared
 * state). Returns null when the action does not apply (nothing typed and
 * nothing clearable to clear).
 */
export const applyClear = ({
	cleared,
	clearable,
	isSet,
	typed,
}: ClearContext): null | WriteOnlyOutcome => {
	if (typed) {
		return { cleared, value: cleared ? null : undefined }
	}
	if (clearable && isSet && !cleared) {
		return { cleared: true, value: null }
	}
	return null
}

/** Undo leaves the cleared state, back to keeping the stored value. */
export const applyUndo = (): WriteOnlyOutcome => ({ cleared: false, value: undefined })

/**
 * Blur trims staged text: a pasted credential's trailing newline or space
 * would otherwise be sealed into a broken secret nobody can ever read back to
 * debug. Whitespace-only input counts as emptied. Returns null when nothing
 * changes (numbers, untyped states, already-trimmed text).
 */
export const applyBlur = (
	value: unknown,
	{ cleared, isNumber }: InputContext
): null | WriteOnlyOutcome => {
	if (isNumber || typeof value !== 'string' || value === '') {
		return null
	}
	const trimmed = value.trim()
	if (trimmed === value) {
		return null
	}
	if (trimmed === '') {
		return { cleared, value: cleared ? null : undefined }
	}
	return { cleared, value: trimmed }
}

/** A successful save resolves every staged intent; the server state is now truth. */
export const applySave = (): WriteOnlyOutcome => ({ cleared: false, value: undefined })
