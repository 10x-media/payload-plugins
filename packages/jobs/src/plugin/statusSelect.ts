import type { CollectionConfig } from 'payload'

/**
 * Fields the list cells derive from, beyond their own column: the Status cell reads
 * the job's state, the Job cell its workflow or task slug, and the Status cell the
 * schedule's `meta` for its Cron badge.
 */
export const CELL_INPUTS = [
	'completedAt',
	'error',
	'hasError',
	'meta',
	'processingUntil',
	'taskSlug',
	'totalTried',
	'waitUntil',
	'workflowSlug',
] as const

type SelectArgs = Parameters<NonNullable<CollectionConfig['select']>>[0]

/**
 * A collection `select` that adds `CELL_INPUTS` to any include-mode select. Payload 4's
 * list view selects only its visible columns, so without this the Status column of a
 * list showing Job, Status and Queue would read every job as queued. An exclude-mode
 * select (or none) already returns the inputs and passes through. Runs after the
 * collection's own `select`, if it had one.
 */
export const withCellInputs = (
	prior: CollectionConfig['select']
): NonNullable<CollectionConfig['select']> => {
	const selectFn = (args: SelectArgs): SelectArgs['select'] => {
		const resolved = prior ? prior(args) : undefined
		const select = (resolved === undefined ? args.select : resolved) as
			| Record<string, unknown>
			| undefined
		if (!select || Object.values(select).some((value) => value === false)) {
			return resolved
		}
		const missing = CELL_INPUTS.filter((name) => !select[name])
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
