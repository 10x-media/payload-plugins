/**
 * `req.context` key the vote-submit endpoint sets to the id of the submission a cookie-identified
 * re-vote is updating. Its presence is what opts the update operation into the create-grade
 * pipeline: the spam guard, full validation in `validateSubmission`, the dedup rule's
 * self-exclusion, and the voted-cookie refresh all key off it, so an unflagged update (host
 * server code, admin tooling) keeps today's behavior exactly.
 *
 * Kept apart from `votedCookie`, which signs cookies with `node:crypto`: the built-in validation
 * rules read this key and ship in the `./react` client entry.
 */
export const VOTE_CHANGE_CONTEXT_KEY = 'formBuilderVoteChange'

/** The change-target submission id a flagged request carries, or undefined. */
export const voteChangeTargetOf = (req: {
	context?: Record<string, unknown>
}): number | string | undefined => {
	const target = req.context?.[VOTE_CHANGE_CONTEXT_KEY]
	return typeof target === 'string' || typeof target === 'number' ? target : undefined
}
