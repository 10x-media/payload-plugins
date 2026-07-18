import type { Field } from 'payload'
import { keys } from '../translations/keys'
import { labelForKey } from '../translations/server'

const ENDPOINT_OPTIONS_SELECT_REF = '@10x-media/form-builder/client#EndpointOptionsSelect'

/** The default poll-outcome fields, keyed by field. What the `poll.outcomeFields` seam receives. */
export type DefaultOutcomeFields = {
	winningValues: Field
	resolvedAt: Field
}

/**
 * Composes the forms poll `outcome` group. Receives the two default fields; the returned array
 * becomes the group's fields verbatim, so swapping `winningValues` for a host component (e.g. a
 * relationship picker over the voteable records), reordering, or adding a field is explicit.
 * `pollOutcomeBeforeChange` validates every stored winning value against the poll's effective
 * options server-side regardless of which component renders it, so a swap cannot bypass the
 * membership check.
 */
export type OutcomeFieldsOverride = (args: { defaultFields: DefaultOutcomeFields }) => Field[]

/**
 * The winners field (`poll.outcome.winningValues`): a `hasMany` text field whose default admin
 * component is the `poll-options` endpoint select rendered as a multi-select, so a tie records
 * every winner. Each stored value is matched against the poll's effective options by
 * `pollOutcomeBeforeChange`; a host may swap the component, but the stored contract stays an array
 * of `PollOption.value` strings so membership validation keeps working.
 */
export const buildWinningValuesField = (): Field => ({
	name: 'winningValues',
	type: 'text',
	hasMany: true,
	label: labelForKey(keys.pollWinningValue),
	admin: {
		components: {
			Field: {
				path: ENDPOINT_OPTIONS_SELECT_REF,
				clientProps: {
					endpoint: 'poll-options',
					descriptionKey: keys.pollWinningValueDescription,
					isMulti: true,
				},
			},
		},
	},
})

/**
 * The resolved-at stamp field (`poll.outcome.resolvedAt`): read-only and locked against every
 * caller write via field-level access, so only `pollOutcomeBeforeChange` (which runs after access
 * filtering) can stamp it. Kept in the defaults so a host override that preserves it keeps the lock.
 */
export const buildResolvedAtField = (): Field => ({
	name: 'resolvedAt',
	type: 'date',
	label: labelForKey(keys.pollResolvedAt),
	admin: { readOnly: true },
	access: { create: () => false, update: () => false },
})

/** Both defaults, exactly what the `poll.outcomeFields` seam is handed. */
export const buildDefaultOutcomeFields = (): DefaultOutcomeFields => ({
	winningValues: buildWinningValuesField(),
	resolvedAt: buildResolvedAtField(),
})
