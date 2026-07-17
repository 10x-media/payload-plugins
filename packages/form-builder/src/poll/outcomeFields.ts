import type { Field } from 'payload'
import { keys } from '../translations/keys'
import { labelForKey } from '../translations/server'

const ENDPOINT_OPTIONS_SELECT_REF = '@10x-media/form-builder/client#EndpointOptionsSelect'

/** The default poll-outcome fields, keyed by field. What the `poll.outcomeFields` seam receives. */
export type DefaultOutcomeFields = {
	winningValue: Field
	resolvedAt: Field
}

/**
 * Composes the forms poll `outcome` group. Receives the two default fields; the returned array
 * becomes the group's fields verbatim, so swapping `winningValue` for a host component (e.g. a
 * relationship picker over the voteable records), reordering, or adding a field is explicit.
 * `pollOutcomeBeforeChange` validates the stored `winningValue` against the poll's effective
 * options server-side regardless of which component renders it, so a swap cannot bypass the
 * membership check.
 */
export type OutcomeFieldsOverride = (args: { defaultFields: DefaultOutcomeFields }) => Field[]

/**
 * The winner field (`poll.outcome.winningValue`): a text field whose default admin component is the
 * `poll-options` endpoint select. Its stored value is matched against the poll's effective options
 * by `pollOutcomeBeforeChange`; a host may swap the component, but the stored contract stays a
 * `PollOption.value` string so membership validation keeps working.
 */
export const buildWinningValueField = (): Field => ({
	name: 'winningValue',
	type: 'text',
	label: labelForKey(keys.pollWinningValue),
	admin: {
		components: {
			Field: {
				path: ENDPOINT_OPTIONS_SELECT_REF,
				clientProps: {
					endpoint: 'poll-options',
					descriptionKey: keys.pollWinningValueDescription,
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
	winningValue: buildWinningValueField(),
	resolvedAt: buildResolvedAtField(),
})
