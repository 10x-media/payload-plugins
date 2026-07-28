import type { Payload, PayloadRequest } from 'payload'
import { aggregateFieldResponses } from '../../aggregation/aggregateResponses'
import { FORMS_SLUG } from '../../collections/forms'
import { pollConfigOf } from '../../form/pollState'
import { bumpPollVote } from './bumpPollVote'
import { POLL_VOTES_SLUG, RESPONDENTS_VALUE } from './votesCollection'

/**
 * Rebuild a form's tally rows from persisted submissions (drift healing after out-of-band DB
 * changes, or backfill after enabling a poll late). Deletes the form's tally rows for the
 * results field, then replays the scan aggregation into fresh rows. For persist-off forms the
 * tally is the source of truth and there is nothing to rebuild.
 */
export const recountPollVotes = async (args: {
	payload: Payload
	formId: number | string
	req?: PayloadRequest
}): Promise<void> => {
	const { payload, formId, req } = args
	const form = await payload
		.findByID({ collection: FORMS_SLUG, id: formId, depth: 0, overrideAccess: true, req })
		.catch(() => null)
	const poll = form ? pollConfigOf(form.poll) : undefined
	const resultsField =
		typeof poll?.resultsField === 'string' && poll.resultsField.length > 0
			? poll.resultsField
			: undefined
	if (!resultsField) {
		return
	}
	await payload.delete({
		collection: POLL_VOTES_SLUG,
		where: {
			and: [{ form: { equals: String(formId) } }, { field: { equals: resultsField } }],
		},
		overrideAccess: true,
		req,
	})
	const aggregation = await aggregateFieldResponses({
		payload,
		formId,
		field: resultsField,
		req,
		maxSubmissions: 100_000,
	})
	if (!aggregation) {
		return
	}
	const base = { form: String(formId), field: resultsField }
	for (const bucket of aggregation.buckets) {
		if (bucket.count > 0) {
			await bumpPollVote(payload, { ...base, value: bucket.value }, bucket.count)
		}
	}
	if (aggregation.total > 0) {
		await bumpPollVote(payload, { ...base, value: RESPONDENTS_VALUE }, aggregation.total)
	}
}
