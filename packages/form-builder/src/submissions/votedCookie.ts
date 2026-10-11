import type { Payload } from 'payload'
import { signFormContext, verifyFormContext } from '../context/formContext'
import {
	DEFAULT_VOTED_COOKIE_PREFIX,
	pluginSlugsOf,
	votedCookiePrefixOf,
} from '../plugin/collectionSlugs'

/**
 * `req.context` key under which `validateSubmission` stashes the loaded form's poll state
 * (`{ pollEnabled, allowChange }`) so the voted-cookie `afterChange` hook can skip a second form
 * fetch on the same request.
 */
export const POLL_CONTEXT_KEY = 'formBuilderPollConfig'

/** The poll state `validateSubmission` stashes under {@link POLL_CONTEXT_KEY}. */
export type PollContextState = { pollEnabled: boolean; allowChange: boolean }

export { VOTE_CHANGE_CONTEXT_KEY, voteChangeTargetOf } from './voteChange'

/** One year, matching the voted cookie's `Max-Age` so the token never outlives the cookie by less. */
export const VOTED_COOKIE_MAX_AGE_SECONDS = 31_536_000

/**
 * Name of the httpOnly voted cookie for a form: `fb-voted-{formId}` by default. Pass `payload`
 * when the plugin's `poll.cookiePrefix` is set, so the configured prefix is applied.
 */
export const votedCookieName = (formId: number | string, payload?: Payload): string =>
	`${payload ? votedCookiePrefixOf(payload) : DEFAULT_VOTED_COOKIE_PREFIX}${formId}`

/**
 * Whether a request's `Cookie` header carries the voted marker for a form. For SSR hosts: read
 * the header (e.g. Next's `(await headers()).get('cookie')`) and pass the result to `<Poll hasVoted>`.
 * The cookie is httpOnly (set server-side when the plugin's `poll.votedCookie` option is on), so
 * this server read is the only way to consume it. Pass `payload` when `poll.cookiePrefix` is set;
 * without it the default `fb-voted-` name is read.
 */
export const hasVotedCookie = (
	cookieHeader: string | null | undefined,
	formId: number | string,
	payload?: Payload
): boolean => {
	if (!cookieHeader) {
		return false
	}
	return votedCookieValue(cookieHeader, votedCookieName(formId, payload)) != null
}

const votedCookieValue = (cookieHeader: string | null | undefined, name: string): string | null => {
	if (!cookieHeader) {
		return null
	}
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
		relationTo: pluginSlugsOf(payload).formSubmissions,
		value: submissionId,
		expiresIn: VOTED_COOKIE_MAX_AGE_SECONDS,
	})

/**
 * The submission id carried by a form's voted cookie, or null when the header has no cookie for
 * the form, the value is the legacy boolean marker (`1`), or the token fails verification
 * (tampered, wrong secret, expired, or issued for a different submissions collection). Null means
 * "treat the caller as a new voter".
 */
export const votedSubmissionIdFromCookie = (
	cookieHeader: string | null | undefined,
	formId: number | string,
	payload: Payload
): string | null => {
	const value = votedCookieValue(cookieHeader, votedCookieName(formId, payload))
	if (value == null || value.length === 0) {
		return null
	}
	const reference = verifyFormContext(value, payload.secret)
	if (reference == null || reference.relationTo !== pluginSlugsOf(payload).formSubmissions) {
		return null
	}
	return String(reference.value)
}
