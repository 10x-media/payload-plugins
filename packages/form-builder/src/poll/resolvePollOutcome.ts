import type { Payload, PayloadRequest } from 'payload'
import { aggregateFieldResponses } from '../aggregation/aggregateResponses'
import type { FieldAggregation } from '../aggregation/types'
import { FORMS_SLUG } from '../collections/forms'
import { pollConfigOf } from '../form/pollState'
import type { PollOutcomeStrategyArgs } from './definePollType'
import { pollTypesOf } from './pollTypeRegistry'

export type ResolvePollOutcomeArgs = {
	payload: Payload
	formId: number | string
	/**
	 * The winning set: stable option values, each matching one of the poll's choice values (the
	 * host's contract with `PollOption.value`). Pass more than one for a tie, an empty array to clear
	 * the outcome. Omit to auto-resolve via the poll's selected outcome strategy (`poll.type`).
	 */
	winningValues?: string[]
	req?: PayloadRequest
}

/** A strategy result narrowed to a deduped set of non-empty strings. */
const cleanWinners = (value: string[] | undefined): string[] =>
	value === undefined
		? []
		: [
				...new Set(
					value.filter((entry): entry is string => typeof entry === 'string' && entry.length > 0)
				),
			]

/**
 * Record a poll's final outcome server-side, in one of two modes:
 * - explicit: pass `winningValues` when host code already knows the winner(s); more than one is a
 *   tie, and an empty array clears the outcome;
 * - auto: omit it and the poll's selected outcome strategy (`poll.type`, from the `poll.types`
 *   registry, defaulting to `manual`) resolves the winners. `manual` is a no-op; `mostVoted` reads
 *   the aggregated results field; `source` delegates to the option source. A strategy that is not
 *   yet decidable (or `manual`) writes nothing and this returns an empty set, so auto mode is safe
 *   to call repeatedly from the close job and the read fallback.
 *
 * Every write runs through `payload.update` with `overrideAccess`, so the forms collection hook
 * validates each value against the poll's effective options and owns the `poll.outcome.resolvedAt`
 * stamp in both modes (auto-resolved winners are validated exactly as hand-picked ones). Throws only
 * when the form does not exist or is not poll-enabled. Returns the recorded winning set (empty when
 * auto mode did not decide).
 */
export const resolvePollOutcome = async (args: ResolvePollOutcomeArgs): Promise<string[]> => {
	const { payload, formId, req } = args
	const form = await payload.findByID({
		collection: FORMS_SLUG,
		id: formId,
		depth: 0,
		overrideAccess: true,
		req,
	})
	const poll = pollConfigOf(form.poll)
	if (form.pollEnabled !== true || !poll) {
		throw new Error(`Form ${String(formId)} is not poll-enabled; cannot record an outcome.`)
	}

	let winningValues: string[]
	if (args.winningValues !== undefined) {
		winningValues = args.winningValues
	} else {
		const strategyType =
			typeof poll.type === 'string' && poll.type.length > 0 ? poll.type : 'manual'
		const strategy = pollTypesOf(payload).get(strategyType)
		if (!strategy) {
			return []
		}
		let aggregated: FieldAggregation | null | undefined
		const aggregate = async (): Promise<FieldAggregation | null> => {
			if (aggregated === undefined) {
				const resultsField =
					typeof poll.resultsField === 'string' && poll.resultsField.length > 0
						? poll.resultsField
						: undefined
				aggregated = resultsField
					? await aggregateFieldResponses({ payload, formId, field: resultsField, req })
					: null
			}
			return aggregated
		}
		winningValues = cleanWinners(
			await strategy.resolveOutcome({
				payload,
				req,
				form: form as unknown as PollOutcomeStrategyArgs['form'],
				poll,
				aggregate,
			})
		)
		if (winningValues.length === 0) {
			return []
		}
	}

	await payload.update({
		collection: FORMS_SLUG,
		id: formId,
		data: { poll: { outcome: { winningValues } } },
		depth: 0,
		overrideAccess: true,
		req,
	})
	return winningValues
}
