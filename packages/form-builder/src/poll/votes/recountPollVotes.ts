import type { Payload, PayloadRequest } from 'payload'
import { aggregateFieldResponses } from '../../aggregation/aggregateResponses'
import { FORMS_SLUG } from '../../collections/forms'
import { pollConfigOf } from '../../form/pollState'
import { bumpPollVote } from './bumpPollVote'
import { POLL_VOTES_SLUG, RESPONDENTS_VALUE } from './votesCollection'
import { transactionIDOf } from './voteTallyHook'

const RECOUNT_MAX_SUBMISSIONS = 100_000

/**
 * Rebuild a form's tally rows from persisted submissions (drift healing after out-of-band DB
 * changes, or backfill after enabling a poll late). Scans first and refuses a truncated
 * aggregation, then deletes the form's tally rows for the results field and replays the scan
 * into fresh rows, so the store is never left holding a knowingly partial count. Writes join
 * the request's transaction when one is open. For persist-off forms the tally is the source of
 * truth and there is nothing to rebuild.
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
	const aggregation = await aggregateFieldResponses({
		payload,
		formId,
		field: resultsField,
		req,
		maxSubmissions: RECOUNT_MAX_SUBMISSIONS,
	})
	if (aggregation?.truncated) {
		throw new Error(
			`form-builder: recount for form ${String(formId)} aborted: more than ${RECOUNT_MAX_SUBMISSIONS} submissions, the scan was truncated and a rebuilt tally would be partial.`
		)
	}
	await payload.delete({
		collection: POLL_VOTES_SLUG,
		where: {
			and: [{ form: { equals: String(formId) } }, { field: { equals: resultsField } }],
		},
		overrideAccess: true,
		req,
	})
	if (!aggregation) {
		return
	}
	const transactionID = transactionIDOf(req?.transactionID)
	const base = { form: String(formId), field: resultsField }
	for (const bucket of aggregation.buckets) {
		if (bucket.count > 0) {
			await bumpPollVote(payload, { ...base, value: bucket.value }, bucket.count, transactionID)
		}
	}
	if (aggregation.total > 0) {
		await bumpPollVote(
			payload,
			{ ...base, value: RESPONDENTS_VALUE },
			aggregation.total,
			transactionID
		)
	}
}
