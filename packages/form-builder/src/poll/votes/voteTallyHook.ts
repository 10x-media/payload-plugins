import type { CollectionAfterChangeHook } from 'payload'
import { FORMS_SLUG } from '../../collections/forms'
import { pollConfigOf } from '../../form/pollState'
import { formIdOf } from '../../submissions/formIdOf'
import type { SubmissionValue } from '../../submissions/types'
import { bumpPollVote } from './bumpPollVote'
import { RESPONDENTS_VALUE } from './votesCollection'

const isComplete = (doc: { status?: unknown }): boolean =>
	doc.status == null || doc.status === 'complete'

const answerValues = (values: unknown, field: string): string[] => {
	if (!Array.isArray(values)) return []
	const entry = (values as SubmissionValue[]).find((row) => row.field === field)
	if (entry == null) return []
	const raw = Array.isArray(entry.value) ? entry.value : [entry.value]
	return raw.filter((value) => value != null && value !== '').map((value) => String(value))
}

/** Narrow a request's loosely typed `transactionID` to the value `bumpPollVote` accepts. */
export const transactionIDOf = (transactionID: unknown): number | string | undefined =>
	typeof transactionID === 'number' || typeof transactionID === 'string' ? transactionID : undefined

/**
 * Append-only vote counting: a submission entering `complete` bumps one tally per answer value
 * for the poll results field, plus the shared respondents row. Votes are permanent by design:
 * no decrement on delete, edit, or prune, which is what lets a pruned submission's vote
 * survive. Bump failures propagate so the enclosing transaction rolls the submission back
 * rather than silently undercounting; registered before the swallow-all dispatch hook.
 */
export const makeVoteTallyHook =
	(): CollectionAfterChangeHook =>
	async ({ doc, previousDoc, operation, req }) => {
		if (operation !== 'create' && operation !== 'update') return doc
		const entering =
			(operation === 'create' && isComplete(doc)) ||
			(operation === 'update' && isComplete(doc) && !isComplete(previousDoc ?? {}))
		if (!entering) return doc
		const formId = formIdOf(doc.form)
		if (formId == null) return doc
		const form = await req.payload
			.findByID({ collection: FORMS_SLUG, id: formId, depth: 0, overrideAccess: true, req })
			.catch(() => null)
		const poll = form?.pollEnabled === true ? pollConfigOf(form.poll) : undefined
		const resultsField =
			typeof poll?.resultsField === 'string' && poll.resultsField.length > 0
				? poll.resultsField
				: undefined
		if (!resultsField) return doc
		const votes = answerValues(doc.values, resultsField)
		if (votes.length === 0) return doc
		const transactionID = transactionIDOf(req.transactionID)
		const base = { form: String(formId), field: resultsField }
		for (const value of votes) {
			await bumpPollVote(req.payload, { ...base, value }, 1, transactionID)
		}
		await bumpPollVote(req.payload, { ...base, value: RESPONDENTS_VALUE }, 1, transactionID)
		return doc
	}
