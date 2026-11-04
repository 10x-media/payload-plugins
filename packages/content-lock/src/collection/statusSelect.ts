import type { CollectionConfig } from 'payload'

/** The stored fields the `status` field derives a window's stage from. */
export const STATUS_INPUTS = [
	'_status',
	'announce',
	'announceAt',
	'endAtTime',
	'endedAt',
	'endsAt',
	'startsAt',
] as const

type SelectArgs = Parameters<NonNullable<CollectionConfig['select']>>[0]

/**
 * A collection `select` that adds `STATUS_INPUTS` whenever an include-mode
 * select asks for `status`. Payload 4's list view selects only its visible
 * columns, so a list showing Title and Lock status read every ended window
 * without its end and labelled it active. Runs after the collection's own
 * `select`, if it had one.
 */
export const withStatusInputs = (
	prior: CollectionConfig['select']
): NonNullable<CollectionConfig['select']> => {
	const selectFn = (args: SelectArgs): SelectArgs['select'] => {
		const resolved = prior ? prior(args) : undefined
		const select = (resolved === undefined ? args.select : resolved) as
			| Record<string, unknown>
			| undefined
		if (!select?.status || Object.values(select).some((value) => value === false)) {
			return resolved
		}
		const missing = STATUS_INPUTS.filter((name) => !select[name])
		if (missing.length === 0) {
			return resolved
		}
		return {
			...select,
			...Object.fromEntries(missing.map((name) => [name, true])),
		} as SelectArgs['select']
	}
	return selectFn as NonNullable<CollectionConfig['select']>
}
