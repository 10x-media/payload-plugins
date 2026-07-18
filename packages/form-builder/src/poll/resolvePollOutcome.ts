import type { Payload, PayloadRequest } from 'payload'
import { FORMS_SLUG } from '../collections/forms'
import { type PollConfigLike, pollConfigOf } from '../form/pollState'
import { pollOptionSourcesOf } from './resolvePollOptions'

export type ResolvePollOutcomeArgs = {
	payload: Payload
	formId: number | string
	/**
	 * The winning set: stable option values, each matching one of the poll's choice values (the
	 * host's contract with `PollOption.value`). Pass more than one for a tie. Omit to resolve the
	 * winners automatically via the poll's option source `resolveOutcome`.
	 */
	winningValues?: string[]
	req?: PayloadRequest
}

/** A source's `resolveOutcome` return narrowed to a winner set, or `undefined` when undecidable. */
const normalizeSourceOutcome = (value: string | string[] | undefined): string[] | undefined => {
	if (value === undefined) {
		return undefined
	}
	const cleaned = (Array.isArray(value) ? value : [value]).filter(
		(entry): entry is string => typeof entry === 'string' && entry.length > 0
	)
	return cleaned.length > 0 ? cleaned : undefined
}

const resolveWinnersFromSource = async (args: {
	payload: Payload
	form: { id: number | string; title?: unknown }
	poll: PollConfigLike
	req?: PayloadRequest
}): Promise<string[]> => {
	const { payload, form, poll, req } = args
	const optionSource =
		typeof poll.optionSource === 'string' && poll.optionSource.length > 0
			? poll.optionSource
			: undefined
	if (!optionSource) {
		throw new Error(
			`Form ${String(form.id)} has no poll option source; pass winningValues explicitly or set poll.optionSource on the form.`
		)
	}
	const source = pollOptionSourcesOf(payload).get(optionSource)
	if (!source) {
		throw new Error(
			`Poll option source "${optionSource}" is not registered. Register it via the plugin's poll.sources option.`
		)
	}
	if (!source.resolveOutcome) {
		throw new Error(
			`Poll option source "${optionSource}" does not implement resolveOutcome; add it to the source or pass winningValues explicitly.`
		)
	}
	const config =
		poll.sourceConfig != null && typeof poll.sourceConfig === 'object'
			? (poll.sourceConfig as Record<string, unknown>)
			: {}
	const winners = normalizeSourceOutcome(
		await source.resolveOutcome({
			config,
			form: { id: form.id, title: typeof form.title === 'string' ? form.title : undefined },
			payload,
			req,
		})
	)
	if (winners === undefined) {
		throw new Error(
			`Poll option source "${optionSource}" returned no outcome for form ${String(form.id)}; the result may not be decided yet. Try again later or pass winningValues explicitly.`
		)
	}
	return winners
}

/**
 * Record a poll's final outcome server-side, in one of two modes:
 * - explicit: pass `winningValues` when host code already knows the winner(s); more than one is a
 *   tie, and an empty array clears the outcome;
 * - auto: omit it and the poll's configured option source resolves the winners from domain data via
 *   its `resolveOutcome`. Throws when the poll has no option source, the source is unregistered or
 *   lacks `resolveOutcome`, or `resolveOutcome` yields no winner (outcome not yet decidable).
 *
 * The write runs through `payload.update` with `overrideAccess`, so the forms collection hook
 * validates every value against the poll's effective options in both modes and stamps
 * `poll.outcome.resolvedAt` (set or changed: now; re-recording the same set keeps the original
 * stamp; admins picking winners in the sidebar go through the same hook). Throws when the form does
 * not exist or is not poll-enabled. Returns the recorded winning set, which auto-mode callers
 * otherwise would not know.
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
	const winningValues =
		args.winningValues ?? (await resolveWinnersFromSource({ payload, form, poll, req }))
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
