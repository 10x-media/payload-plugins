import type { Field, Payload, PayloadRequest } from 'payload'
import type { FieldAggregation } from '../aggregation/types'
import type { PollConfigLike } from '../form/pollState'

export type PollOutcomeStrategyArgs = {
	payload: Payload
	req?: PayloadRequest
	/** The loaded forms document, widened so a strategy can read host-owned members (e.g. `form.tenant`). */
	form: { id: number | string; poll?: unknown; fields?: unknown } & Record<string, unknown>
	/** The poll config narrowed from the form via `pollConfigOf`. */
	poll: PollConfigLike
	/** Aggregate the poll's results field, memoized by the caller. Null when there is no results field or no data. */
	aggregate: () => Promise<FieldAggregation | null>
}

/**
 * An outcome-resolution strategy for a poll, authored once and registered via the plugin `poll.types`
 * option (built-ins `manual`, `mostVoted`, `source` are always registered). The poll's `type` select
 * picks one; `resolvePollOutcome` runs it when no explicit `winningValues` are passed. `resolveOutcome`
 * returns the winning value set, or `undefined` when the outcome is not yet decidable so nothing is
 * written. Every returned value is still validated against the poll's effective options by
 * `pollOutcomeBeforeChange`, so a strategy can never record a value outside the poll's choices.
 */
export type PollOutcomeStrategy = {
	type: string
	/** i18n-key or literal (resolved like a field label), or a per-locale record. */
	label: string | Record<string, string>
	config?: Field[]
	resolveOutcome: (
		args: PollOutcomeStrategyArgs
	) => Promise<string[] | undefined> | string[] | undefined
}

export const definePollType = (strategy: PollOutcomeStrategy): PollOutcomeStrategy => strategy
