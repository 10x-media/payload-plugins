import { keys } from '../translations/keys'
import { definePollType, type PollOutcomeStrategy } from './definePollType'

/**
 * Every bucket value tied for the highest count, so a draw records all co-winners. Empty when there
 * are no buckets. Pure: the caller decides whether the aggregation is trustworthy enough to act on.
 */
export const topBucketValues = (buckets: { value: string; count: number }[]): string[] => {
	if (buckets.length === 0) {
		return []
	}
	const max = Math.max(...buckets.map((bucket) => bucket.count))
	return buckets.filter((bucket) => bucket.count === max).map((bucket) => bucket.value)
}

/**
 * Auto-resolve to whichever choice(s) received the most votes. Refuses to decide, returning
 * `undefined` (no write), when there is no aggregation, no responses yet, or the aggregation was
 * `truncated` (a sample cannot be trusted to name the true winner, so it is flagged for a manual
 * call instead). A perfect tie records every co-winner.
 */
export const mostVotedStrategy: PollOutcomeStrategy = definePollType({
	type: 'mostVoted',
	label: keys.pollTypeMostVoted,
	resolveOutcome: async ({ aggregate }) => {
		const aggregation = await aggregate()
		if (!aggregation || aggregation.total === 0 || aggregation.truncated) {
			return undefined
		}
		const winners = topBucketValues(aggregation.buckets)
		return winners.length > 0 ? winners : undefined
	},
})
