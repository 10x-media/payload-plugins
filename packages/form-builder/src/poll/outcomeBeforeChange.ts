import { type CollectionBeforeChangeHook, ValidationError } from 'payload'
import { FORMS_SLUG } from '../collections/forms'
import { pollConfigOf } from '../form/pollState'
import { keys } from '../translations/keys'
import { asTranslate } from '../translations/server'
import type { PollOption } from './definePollOptionSource'
import { resolveEffectivePollOptions } from './effectivePollOptions'

const WINNING_VALUE_PATH = 'poll.outcome.winningValue'

const normalizeWinning = (value: unknown): string | undefined =>
	typeof value === 'string' && value.length > 0 ? value : undefined

/**
 * Owns the poll outcome lifecycle for every create and update, admin and API alike. When the save
 * writes `poll.outcome.winningValue` it validates a set or changed winner against the poll's
 * effective options (source-resolved or authored, over a merged view of the doc so partial updates
 * validate against stored config) and requires the poll to be enabled; clearing is always allowed.
 *
 * It is also the single `resolvedAt` stamping point: stamped when the winner is set or changed,
 * cleared with the winner, untouched when the winner is unchanged. Callers can never write
 * `resolvedAt` themselves (field-level access strips it during the beforeValidate traversal,
 * before this hook runs), while values this hook sets survive to the database, so the stamp
 * always reflects the actual transition regardless of the write path.
 */
export const pollOutcomeBeforeChange: CollectionBeforeChangeHook = async ({
	data,
	originalDoc,
	req,
}) => {
	const incomingPoll =
		data?.poll != null && typeof data.poll === 'object'
			? (data.poll as Record<string, unknown>)
			: undefined
	const outcome =
		incomingPoll?.outcome != null && typeof incomingPoll.outcome === 'object'
			? (incomingPoll.outcome as Record<string, unknown>)
			: undefined
	if (!outcome || !('winningValue' in outcome)) {
		return data
	}
	const next = normalizeWinning(outcome.winningValue)
	if (next === undefined) {
		outcome.winningValue = null
	}
	const previous = normalizeWinning(pollConfigOf(originalDoc?.poll)?.outcome?.winningValue)
	if (next === previous) {
		return data
	}
	if (next === undefined) {
		outcome.resolvedAt = null
		return data
	}

	const t = asTranslate(req.t)
	const fail = (message: string): never => {
		throw new ValidationError(
			{ collection: FORMS_SLUG, errors: [{ path: WINNING_VALUE_PATH, message }] },
			req.t
		)
	}
	const originalPoll =
		originalDoc?.poll != null && typeof originalDoc.poll === 'object'
			? (originalDoc.poll as Record<string, unknown>)
			: undefined
	const mergedPoll = { ...(originalPoll ?? {}), ...incomingPoll }
	// The poll-enable flag lives at the document root now; merge the incoming partial over the stored
	// doc so a partial update that omits it still validates against the persisted value.
	const mergedPollEnabled = { ...(originalDoc ?? {}), ...data }.pollEnabled === true
	if (!mergedPollEnabled) {
		fail(t(keys.validationWinningValueDisabled))
	}
	const id = (originalDoc?.id ?? data?.id) as number | string | undefined
	const form = {
		id: id ?? '',
		title:
			typeof data?.title === 'string' ? data.title : (originalDoc?.title as string | undefined),
		pollEnabled: mergedPollEnabled,
		poll: mergedPoll,
		fields: data?.fields ?? originalDoc?.fields,
	}
	let options: PollOption[]
	try {
		// Without a doc id (create) the per-request options cache would key on '', so skip it.
		options = await resolveEffectivePollOptions({
			payload: req.payload,
			req: id != null ? req : undefined,
			form,
		})
	} catch {
		return fail(t(keys.pollOptionsUnavailable))
	}
	if (!options.some((option) => option.value === next)) {
		fail(t(keys.validationWinningValueUnknown))
	}
	outcome.resolvedAt = new Date().toISOString()
	return data
}
