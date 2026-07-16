import type { PollOption } from './definePollOptionSource'

/**
 * Replace the options of the field instance named `resultsField` with source-resolved options,
 * without mutating the input. No-op when `resultsField` is unset or matches no instance, so
 * hand-authored options stay untouched on forms without an option source.
 */
export const applyPollOptions = <T extends { name: string }>(
	fields: T[],
	resultsField: string | null | undefined,
	options: PollOption[]
): T[] => {
	if (typeof resultsField !== 'string' || resultsField.length === 0) {
		return fields
	}
	return fields.map((instance) =>
		instance.name === resultsField ? { ...instance, options } : instance
	)
}
