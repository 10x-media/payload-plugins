import type { Payload } from 'payload'
import { signFormContext, verifyFormContext } from '../context/formContext'

/**
 * `req.context` key under which `validateSubmission` stashes the loaded form's poll state
 * (`{ pollEnabled, allowChange }`) so the voted-cookie `afterChange` hook can skip a second form
 * fetch on the same request.
 */
export const POLL_CONTEXT_KEY = 'formBuilderPollConfig'

/** The poll state `validateSubmission` stashes under {@link POLL_CONTEXT_KEY}. */
export type PollContextState = { pollEnabled: boolean; allowChange: boolean }

/**
 * `req.context` key the vote-submit endpoint sets to the id of the submission a cookie-identified
 * re-vote is updating. Its presence is what opts the update operation into the create-grade
 * pipeline: the spam guard, full validation in `validateSubmission`, the dedup rule's
 * self-exclusion, and the voted-cookie refresh all key off it, so an unflagged update (host
 * server code, admin tooling) keeps today's behavior exactly.
 */
export const VOTE_CHANGE_CONTEXT_KEY = 'formBuilderVoteChange'

/** The change-target submission id a flagged request carries, or undefined. */
export const voteChangeTargetOf = (req: {
	context?: Record<string, unknown>
}): number | string | undefined => {
	const target = req.context?.[VOTE_CHANGE_CONTEXT_KEY]
	return typeof target === 'string' || typeof target === 'number' ? target : undefined
}

/** Redeclared to avoid a cycle: `collections/formSubmissions` imports from this module. */
const FORM_SUBMISSIONS_SLUG = 'form-submissions'

/** One year, matching the voted cookie's `Max-Age` so the token never outlives the cookie by less. */
export const VOTED_COOKIE_MAX_AGE_SECONDS = 31_536_000

/** Name of the httpOnly voted cookie for a form: `fb-voted-{formId}`. */
export const votedCookieName = (formId: number | string): string => `fb-voted-${formId}`

/**
 * Whether a request's `Cookie` header carries the voted marker for a form. For SSR hosts: read
 * the header (e.g. Next's `(await headers()).get('cookie')`) and pass the result to `<Poll hasVoted>`.
 * The cookie is httpOnly (set server-side when the plugin's `poll.votedCookie` option is on), so
 * this server read is the only way to consume it.
 */
export const hasVotedCookie = (
	cookieHeader: string | null | undefined,
	formId: number | string
): boolean => {
	if (!cookieHeader) {
		return false
	}
	return votedCookieValue(cookieHeader, formId) != null
}

const votedCookieValue = (
	cookieHeader: string | null | undefined,
	formId: number | string
): string | null => {
	if (!cookieHeader) {
		return null
	}
	const name = votedCookieName(formId)
	for (const pair of cookieHeader.split(';')) {
		const eq = pair.indexOf('=')
		if (eq !== -1 && pair.slice(0, eq).trim() === name) {
			return pair.slice(eq + 1).trim()
		}
	}
	return null
}

/**
 * Sign a submission id into the voted cookie's value for an `allowChange` poll. The token (same
 * HMAC format as `signFormContext`) is what lets a repeat submit update that submission in place;
 * signing means only ids the server issued are accepted, so a forged cookie cannot point a
 * re-vote at someone else's submission.
 */
export const signVotedCookieValue = (payload: Payload, submissionId: number | string): string =>
	signFormContext({
		payload,
		relationTo: FORM_SUBMISSIONS_SLUG,
		value: submissionId,
		expiresIn: VOTED_COOKIE_MAX_AGE_SECONDS,
	})

/**
 * The submission id carried by a form's voted cookie, or null when the header has no cookie for
 * the form, the value is the legacy boolean marker (`1`), or the token fails verification
 * (tampered, wrong secret, expired). Null means "treat the caller as a new voter".
 */
export const votedSubmissionIdFromCookie = (
	cookieHeader: string | null | undefined,
	formId: number | string,
	secret: string
): string | null => {
	const value = votedCookieValue(cookieHeader, formId)
	if (value == null || value.length === 0) {
		return null
	}
	const reference = verifyFormContext(value, secret)
	if (reference == null || reference.relationTo !== FORM_SUBMISSIONS_SLUG) {
		return null
	}
	return String(reference.value)
}
