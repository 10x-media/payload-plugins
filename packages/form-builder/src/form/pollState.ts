/** Poll settings as loaded from a forms document (server) or a `FormDocument` (client). */
export type PollConfigLike = {
	enabled?: boolean | null
	resultsField?: string | null
	resultsVisibility?: string | null
	closesAt?: string | null
}

/** Narrow a forms document's untyped `poll` member. */
export const pollConfigOf = (poll: unknown): PollConfigLike | undefined =>
	poll != null && typeof poll === 'object' ? (poll as PollConfigLike) : undefined

/**
 * Whether the poll's `closesAt` has passed. An unset or unparseable `closesAt` never closes;
 * framework-agnostic so the server guard, the results gate, and the client `<Poll>` agree.
 */
export const isPollClosed = (
	poll: PollConfigLike | null | undefined,
	now: number = Date.now()
): boolean => {
	const closesAt = poll?.closesAt
	if (typeof closesAt !== 'string' || closesAt.length === 0) {
		return false
	}
	const ts = Date.parse(closesAt)
	return Number.isFinite(ts) && ts <= now
}
