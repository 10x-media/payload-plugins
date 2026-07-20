export type CommitResolution = {
	lastValid: null | string
	reverted: boolean
	value: null | string
}

/**
 * Decides what a text commit (blur or debounced) stores. Non-clearable fields
 * revert empty or unparseable drafts to the last valid committed value so
 * emptying the text never clears the field; without a prior valid value the
 * draft commits as-is (empty stays empty, garbage surfaces via validation).
 */
export const resolveCommitValue = (args: {
	draft: string
	isClearable: boolean
	lastValid: null | string
	/** Normalized committable value when the draft parses (formatted color or preset ref), else null. */
	parsed: null | string
}): CommitResolution => {
	const { draft, isClearable, lastValid, parsed } = args
	if (parsed !== null) return { lastValid: parsed, reverted: false, value: parsed }
	if (!isClearable && lastValid !== null) return { lastValid, reverted: true, value: lastValid }
	return { lastValid, reverted: false, value: draft.trim() === '' ? null : draft }
}
