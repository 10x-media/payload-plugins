import type { CollectionConfig } from 'payload'
import { isLoggedIn } from '../../plugin/access'
import type { CollectionOverrides } from '../../plugin/collectionOverrides'
import { keys } from '../../translations/keys'
import { labelForKey } from '../../translations/server'

export const POLL_VOTES_SLUG = 'form-poll-votes'

/** Reserved tally `value` marking the per-field respondents counter (empty answers are never counted, so '' is free). */
export const RESPONDENTS_VALUE = ''

/**
 * Append-only aggregate tallies: one row per (form, field, value) with a running count, plus one
 * respondents row per (form, field) under RESPONDENTS_VALUE. Rows carry no per-voter data and are
 * written via atomic upsert-increments (see bumpPollVote), made concurrency-safe by the unique
 * compound index. Ids are stored as strings for cross-DB parity.
 *
 * `indexes` is intentionally not part of the override surface: the unique compound index is
 * load-bearing for the atomic upsert-increment, so it is fixed rather than spread with the rest.
 */
export const buildPollVotesCollection = (args: {
	overrides?: CollectionOverrides
}): CollectionConfig => {
	const defaultFields: CollectionConfig['fields'] = [
		{ name: 'form', type: 'text', required: true, index: true },
		{ name: 'field', type: 'text', required: true },
		{ name: 'value', type: 'text' },
		{ name: 'count', type: 'number', required: true, defaultValue: 0 },
	]

	return {
		...(args.overrides ?? {}),
		slug: POLL_VOTES_SLUG,
		labels: {
			singular: labelForKey(keys.collectionPollVoteSingular),
			plural: labelForKey(keys.collectionPollVotePlural),
			...(args.overrides?.labels ?? {}),
		},
		admin: { hidden: true, ...(args.overrides?.admin ?? {}) },
		access: { read: isLoggedIn, ...(args.overrides?.access ?? {}) },
		indexes: [{ fields: ['form', 'field', 'value'], unique: true }],
		fields: args.overrides?.fields ? args.overrides.fields({ defaultFields }) : defaultFields,
	}
}
