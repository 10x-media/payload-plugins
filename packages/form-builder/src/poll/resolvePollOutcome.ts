import type { Payload, PayloadRequest } from 'payload'
import { FORMS_SLUG } from '../collections/forms'
import { pollConfigOf } from '../form/pollState'

export type ResolvePollOutcomeArgs = {
	payload: Payload
	formId: number | string
	/** A stable option value, matching one of the poll's choice values (the host's contract with `PollOption.value`). */
	winningValue: string
	req?: PayloadRequest
}

/**
 * Record a poll's final outcome from host domain logic (e.g. after the race is decided): writes
 * `poll.outcome.winningValue` and stamps `resolvedAt` with the current time. The outcome fields are
 * admin read-only with field-level `update: () => false`, so this server-side call (with
 * `overrideAccess`) is the only write path. Throws when the form does not exist or is not
 * poll-enabled. `<Poll>` treats a present `winningValue` as the final state and highlights the
 * matching result bucket.
 */
export const resolvePollOutcome = async (args: ResolvePollOutcomeArgs): Promise<void> => {
	const { payload, formId, winningValue, req } = args
	const form = await payload.findByID({
		collection: FORMS_SLUG,
		id: formId,
		depth: 0,
		overrideAccess: true,
		req,
	})
	const poll = pollConfigOf(form.poll)
	if (poll?.enabled !== true) {
		throw new Error(`Form ${String(formId)} is not poll-enabled; cannot record an outcome.`)
	}
	await payload.update({
		collection: FORMS_SLUG,
		id: formId,
		data: { poll: { outcome: { winningValue, resolvedAt: new Date().toISOString() } } },
		depth: 0,
		overrideAccess: true,
		req,
	})
}
