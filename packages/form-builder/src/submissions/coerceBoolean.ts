/** Strings that count as boolean true. Shared by prefill and submit-time coercion so they never diverge. */
export const TRUTHY_STRINGS = new Set(['true', '1', 'on', 'yes'])

/** True when a string is an affirmative token (trimmed, case-insensitive); everything else is false. */
export const isTruthyString = (value: string): boolean =>
	TRUTHY_STRINGS.has(value.trim().toLowerCase())
