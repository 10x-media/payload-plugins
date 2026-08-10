import type { CollectionAfterChangeHook } from 'payload'
import { FORMS_SLUG } from '../../collections/forms'
import { pollConfigOf } from '../../form/pollState'
import { formIdOf } from '../../submissions/formIdOf'
import { answerValues } from './answerValues'
import { bumpPollVote } from './bumpPollVote'
import { RESPONDENTS_VALUE } from './votesCollection'

const isComplete = (doc: { status?: unknown }): boolean =>
	doc.status == null || doc.status === 'complete'

/** Narrow a request's loosely typed `transactionID` to the value `bumpPollVote` accepts. */
export const transactionIDOf = (transactionID: unknown): number | string | undefined =>
	typeof transactionID === 'number' || typeof transactionID === 'string' ? transactionID : undefined

/**
 * Vote counting: a submission entering `complete` bumps one tally per answer value for the poll
 * results field, plus the shared respondents row. Votes are permanent by default: no decrement on
 * delete, edit, or prune, which is what lets a pruned submission's vote survive. The one
 * exception is an `allowChange` poll, where an update of an already-complete submission moves the
 * tally with the changed answer (decrement removed values, increment added ones, respondents
 * untouched); delete and prune stay permanent even then. Two concurrent changes of the same
 * submission can each read the same previous answer and double-adjust; the client's double-submit
 * guard makes that rare and `recountPollVotes` is the healer, matching `bumpPollVote`'s residual
 * drift note. Bump failures propagate so the enclosing transaction rolls the submission back
 * rather than silently undercounting; registered before the swallow-all dispatch hook.
 */
export const makeVoteTallyHook =
	(): CollectionAfterChangeHook =>
	async ({ doc, previousDoc, operation, req }) => {
		if (operation !== 'create' && operation !== 'update') return doc
		const entering =
			(operation === 'create' && isComplete(doc)) ||
			(operation === 'update' && isComplete(doc) && !isComplete(previousDoc ?? {}))
		const changing =
			operation === 'update' && isComplete(doc) && isComplete(previousDoc ?? {}) && !entering
		if (!entering && !changing) return doc
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
		const transactionID = transactionIDOf(req.transactionID)
		const base = { form: String(formId), field: resultsField }
		if (changing) {
			if (poll?.allowChange !== true) return doc
			const previous = answerValues(previousDoc?.values, resultsField)
			const next = answerValues(doc.values, resultsField)
			const removed = previous.filter((value) => !next.includes(value))
			const added = next.filter((value) => !previous.includes(value))
			for (const value of removed) {
				await bumpPollVote(req.payload, { ...base, value }, -1, transactionID)
			}
			for (const value of added) {
				await bumpPollVote(req.payload, { ...base, value }, 1, transactionID)
			}
			return doc
		}
		const votes = answerValues(doc.values, resultsField)
		if (votes.length === 0) return doc
		for (const value of votes) {
			await bumpPollVote(req.payload, { ...base, value }, 1, transactionID)
		}
		await bumpPollVote(req.payload, { ...base, value: RESPONDENTS_VALUE }, 1, transactionID)
		return doc
	}
