import type { CollectionConfig } from 'payload'
import { isLoggedIn } from '../../plugin/access'
import type { CollectionOverrides } from '../../plugin/collectionOverrides'
import { DEFAULT_COLLECTION_SLUGS } from '../../plugin/collectionSlugs'
import { keys } from '../../translations/keys'
import { labelForKey } from '../../translations/server'

/**
 * Default slug of the tally collection. A host may rename it via `poll.votes.overrides.slug`;
 * read the live slug with `collectionSlugsOf(payload).pollVotes`.
 */
export const POLL_VOTES_SLUG = DEFAULT_COLLECTION_SLUGS.pollVotes

/** Reserved tally `value` marking the per-field respondents counter (empty answers are never counted, so '' is free). */
export const RESPONDENTS_VALUE = ''

/**
 * Shard count for hot tally counters. Mongo aborts one of two transactions that write the same
 * document (WriteConflict/TransientTransactionError), so concurrent transactional votes for the
 * same (form, field, value) would deterministically fail one submission. Spreading each
 * transactional bump across VOTE_SHARDS rows makes concurrent bumps land on different shards
 * with high probability, so transactions stop contending. Postgres row locks serialize
 * ON CONFLICT updates without aborting and non-transactional Mongo $inc is conflict-free, so
 * both always use shard 0. Reads sum counts across shards.
 */
export const VOTE_SHARDS = 8

/**
 * Append-only aggregate tallies: up to VOTE_SHARDS rows per (form, field, value) with running
 * counts that readers sum, plus respondents rows per (form, field) under RESPONDENTS_VALUE.
 * Rows carry no per-voter data and are written via atomic upsert-increments (see bumpPollVote),
 * made concurrency-safe by the unique compound index. Ids are stored as strings for cross-DB
 * parity.
 *
 * `indexes` is intentionally not part of the override surface: the unique compound index is
 * load-bearing for the atomic upsert-increment, so it is fixed rather than spread with the rest.
 */
export const buildPollVotesCollection = (args: {
	overrides?: CollectionOverrides
	/** The resolved tally slug (`poll.votes.overrides.slug`); the default when omitted. */
	slug?: string
}): CollectionConfig => {
	const defaultFields: CollectionConfig['fields'] = [
		{ name: 'form', type: 'text', required: true, index: true },
		{ name: 'field', type: 'text', required: true },
		{ name: 'value', type: 'text' },
		{ name: 'shard', type: 'number', required: true, defaultValue: 0 },
		{ name: 'count', type: 'number', required: true, defaultValue: 0 },
	]

	return {
		...(args.overrides ?? {}),
		slug: args.slug ?? POLL_VOTES_SLUG,
		labels: {
			singular: labelForKey(keys.collectionPollVoteSingular),
			plural: labelForKey(keys.collectionPollVotePlural),
			...(args.overrides?.labels ?? {}),
		},
		admin: { hidden: true, ...(args.overrides?.admin ?? {}) },
		access: { read: isLoggedIn, ...(args.overrides?.access ?? {}) },
		indexes: [{ fields: ['form', 'field', 'value', 'shard'], unique: true }],
		fields: args.overrides?.fields ? args.overrides.fields({ defaultFields }) : defaultFields,
	}
}
