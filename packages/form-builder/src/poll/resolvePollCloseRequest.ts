import type { Payload, PayloadRequest } from 'payload'
import { FORMS_SLUG } from '../collections/forms'
import { isPollClosed, type PollConfigLike, pollConfigOf } from '../form/pollState'
import { keys } from '../translations/keys'
import { asTranslate } from '../translations/server'
import { resolvePollOutcome } from './resolvePollOutcome'

/** The recorded winning set as non-empty strings; empty means no winner has been set yet. */
const winnersOf = (poll: PollConfigLike): string[] => {
	const winners = poll.outcome?.winningValues
	if (!Array.isArray(winners)) {
		return []
	}
	return winners.filter((value): value is string => typeof value === 'string' && value.length > 0)
}

/** The selected outcome strategy slug; an absent or empty `type` is `manual`. */
const strategyOf = (poll: PollConfigLike): string =>
	typeof poll.type === 'string' && poll.type.length > 0 ? poll.type : 'manual'

/** The slice of a loaded form the close planner reads. */
export type PollCloseFormLike = { pollEnabled?: boolean | null; poll?: unknown }

export type PollClosePlan =
	| { ok: false; reason: 'already-closed' | 'manual-no-winner' | 'not-poll' }
	| { ok: true; resolveOutcome: boolean }

/**
 * Decide what closing a poll now should do, purely from a loaded form so the branch logic is testable
 * without a boot. `manual` requires a winner to already be recorded (closing only stamps the time);
 * `mostVoted`, `source`, and any host strategy auto-resolve on close. Refuses a non-poll form and an
 * already-closed poll (idempotency), so the request helper performs no write unless this returns `ok`.
 */
export const planPollClose = (form: PollCloseFormLike): PollClosePlan => {
	const poll = pollConfigOf(form.poll)
	if (form.pollEnabled !== true || !poll) {
		return { ok: false, reason: 'not-poll' }
	}
	if (isPollClosed(poll)) {
		return { ok: false, reason: 'already-closed' }
	}
	if (strategyOf(poll) === 'manual' && winnersOf(poll).length === 0) {
		return { ok: false, reason: 'manual-no-winner' }
	}
	return { ok: true, resolveOutcome: strategyOf(poll) !== 'manual' }
}

export type ResolvePollCloseRequestArgs = {
	payload: Payload
	formId: number | string | undefined
	/** Whether the caller is authenticated (an admin/user). */
	isAuthed: boolean
	/** Whether the hidden tally store backs the outcome aggregation (see `resolvePollOutcome`). */
	pollVotesEnabled?: boolean
	req: PayloadRequest
}

export type ResolvePollCloseRequestResult = {
	status: number
	body: { closesAt: string; winningValues: string[] } | { errors: { message: string }[] }
}

/**
 * Authorize and perform a manual poll close backing `POST /:id/close`. Only an authenticated caller
 * may close (anonymous is always 403, mirroring the other resolve* helpers); the route is a trusted
 * admin action, so the load and write run with `overrideAccess`. Sets `closesAt` to now through
 * `payload.update` so the collection hooks run, then for a non-manual strategy resolves the winners via
 * `resolvePollOutcome` (auto mode; a non-decidable poll simply records none and the read fallback heals
 * it later). A `manual` poll with no winner recorded is refused (400) so closing never strands a poll
 * with no result. Idempotent: an already-closed poll returns 400 rather than re-closing.
 */
export const resolvePollCloseRequest = async (
	args: ResolvePollCloseRequestArgs
): Promise<ResolvePollCloseRequestResult> => {
	const { payload, formId, isAuthed, pollVotesEnabled, req } = args
	if (!isAuthed) {
		return { status: 403, body: { errors: [{ message: 'Forbidden' }] } }
	}
	if (formId == null) {
		return { status: 400, body: { errors: [{ message: 'Missing form id' }] } }
	}
	const form = await payload
		.findByID({ collection: FORMS_SLUG, id: formId, depth: 0, overrideAccess: true, req })
		.catch(() => null)
	if (!form) {
		return { status: 404, body: { errors: [{ message: 'Not found' }] } }
	}

	const plan = planPollClose(form as PollCloseFormLike)
	if (!plan.ok) {
		if (plan.reason === 'manual-no-winner') {
			return {
				status: 400,
				body: { errors: [{ message: asTranslate(req.t)(keys.pollCloseManualNoWinner) }] },
			}
		}
		const message = plan.reason === 'already-closed' ? 'Poll already closed' : 'Not a poll'
		return { status: 400, body: { errors: [{ message }] } }
	}

	const closesAt = new Date().toISOString()
	await payload.update({
		collection: FORMS_SLUG,
		id: formId,
		data: { poll: { closesAt } },
		depth: 0,
		overrideAccess: true,
		req,
	})

	const winningValues = plan.resolveOutcome
		? await resolvePollOutcome({ payload, formId, pollVotesEnabled, req })
		: winnersOf(pollConfigOf(form.poll) ?? {})
	return { status: 200, body: { closesAt, winningValues } }
}
