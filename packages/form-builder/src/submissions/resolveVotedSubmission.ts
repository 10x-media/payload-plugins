import type { Payload } from 'payload'
import { pollConfigOf } from '../form/pollState'
import { answerValues } from '../poll/votes/answerValues'
import { formIdOf } from './formIdOf'
import { votedSubmissionIdFromCookie } from './votedCookie'

const FORM_SUBMISSIONS_SLUG = 'form-submissions'
const FORMS_SLUG = 'forms'

/** The voter's current vote for a poll, resolved server-side from the httpOnly voted cookie. */
export type VotedSubmission = {
	submissionId: string
	/** The stored answer of the poll results field exactly as submitted (string, or string[] for a multi-select); use it to prefill the form for a vote change. */
	value: unknown
	/** The same answer normalized to non-empty strings; use it to highlight the voter's pick in results. */
	pick: string[]
}

/**
 * Resolve which submission (and which pick) a browser's voted cookie identifies for a form. The
 * cookie is httpOnly, so this is the server-side read: an SSR host passes the incoming request's
 * `Cookie` header (e.g. Next's `(await headers()).get('cookie')`) and hands the result to
 * `<Poll currentVote hasVoted>`. Returns null whenever the cookie is absent, is the legacy `1`
 * marker, fails signature verification, or names a submission that no longer exists or belongs to
 * a different form, so a null simply means "treat this visitor as not having voted". Works for any
 * poll whose cookie carries a signed id (set for `allowChange` polls), even if `allowChange` was
 * later turned off.
 */
export const resolveVotedSubmission = async (args: {
	payload: Payload
	cookieHeader: string | null | undefined
	formId: number | string
}): Promise<VotedSubmission | null> => {
	const { payload, cookieHeader, formId } = args
	const submissionId = votedSubmissionIdFromCookie(cookieHeader, formId, payload.secret)
	if (submissionId == null) {
		return null
	}
	const submission = await payload
		.findByID({
			collection: FORM_SUBMISSIONS_SLUG,
			id: submissionId,
			depth: 0,
			overrideAccess: true,
		})
		.catch(() => null)
	if (submission == null) {
		return null
	}
	const stored = submission as { form?: unknown; status?: unknown; values?: unknown }
	if (String(formIdOf(stored.form) ?? '') !== String(formId)) {
		return null
	}
	if (stored.status != null && stored.status !== 'complete') {
		return null
	}
	const form = await payload
		.findByID({ collection: FORMS_SLUG, id: formId, depth: 0, overrideAccess: true })
		.catch(() => null)
	const poll = form?.pollEnabled === true ? pollConfigOf(form.poll) : undefined
	const resultsField =
		typeof poll?.resultsField === 'string' && poll.resultsField.length > 0
			? poll.resultsField
			: undefined
	if (!resultsField) {
		return null
	}
	const entry = Array.isArray(stored.values)
		? (stored.values as { field?: unknown; value?: unknown }[]).find(
				(row) => row.field === resultsField
			)
		: undefined
	return {
		submissionId: String(submission.id),
		value: entry?.value,
		pick: answerValues(stored.values, resultsField),
	}
}
