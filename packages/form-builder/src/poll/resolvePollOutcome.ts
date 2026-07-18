import type { Payload, PayloadRequest } from 'payload'
import { FORMS_SLUG } from '../collections/forms'
import { type PollConfigLike, pollConfigOf } from '../form/pollState'
import { pollOptionSourcesOf } from './resolvePollOptions'

export type ResolvePollOutcomeArgs = {
	payload: Payload
	formId: number | string
	/**
	 * A stable option value, matching one of the poll's choice values (the host's contract with
	 * `PollOption.value`). Omit to resolve the winner automatically via the poll's option source
	 * `resolveOutcome`.
	 */
	winningValue?: string
	req?: PayloadRequest
}

const resolveWinnerFromSource = async (args: {
	payload: Payload
	form: { id: number | string; title?: unknown }
	poll: PollConfigLike
	req?: PayloadRequest
}): Promise<string> => {
	const { payload, form, poll, req } = args
	const optionSource =
		typeof poll.optionSource === 'string' && poll.optionSource.length > 0
			? poll.optionSource
			: undefined
	if (!optionSource) {
		throw new Error(
			`Form ${String(form.id)} has no poll option source; pass winningValue explicitly or set poll.optionSource on the form.`
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
			`Poll option source "${optionSource}" does not implement resolveOutcome; add it to the source or pass winningValue explicitly.`
		)
	}
	const config =
		poll.sourceConfig != null && typeof poll.sourceConfig === 'object'
			? (poll.sourceConfig as Record<string, unknown>)
			: {}
	const winner = await source.resolveOutcome({
		config,
		form: { id: form.id, title: typeof form.title === 'string' ? form.title : undefined },
		payload,
		req,
	})
	if (winner === undefined) {
		throw new Error(
			`Poll option source "${optionSource}" returned no outcome for form ${String(form.id)}; the result may not be decided yet. Try again later or pass winningValue explicitly.`
		)
	}
	return winner
}

/**
 * Record a poll's final outcome server-side, in one of two modes:
 * - explicit: pass `winningValue` when host code already knows the winner;
 * - auto: omit it and the poll's configured option source resolves the winner from domain data via
 *   its `resolveOutcome`. Throws when the poll has no option source, the source is unregistered or
 *   lacks `resolveOutcome`, or `resolveOutcome` returns `undefined` (outcome not yet decidable).
 *
 * The write runs through `payload.update` with `overrideAccess`, so the forms collection hook
 * validates the value against the poll's effective options in both modes and stamps
 * `poll.outcome.resolvedAt` (set or changed: now; re-recording the same winner keeps the original
 * stamp; admins picking a winner in the sidebar go through the same hook). Throws when the form
 * does not exist or is not poll-enabled. Returns the recorded winning value, which auto-mode
 * callers otherwise would not know.
 */
export const resolvePollOutcome = async (args: ResolvePollOutcomeArgs): Promise<string> => {
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
	const winningValue =
		args.winningValue ?? (await resolveWinnerFromSource({ payload, form, poll, req }))
	await payload.update({
		collection: FORMS_SLUG,
		id: formId,
		data: { poll: { outcome: { winningValue } } },
		depth: 0,
		overrideAccess: true,
		req,
	})
	return winningValue
}
