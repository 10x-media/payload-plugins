/**
 * `req.context` key under which `validateSubmission` stashes whether the loaded form is poll-enabled
 * (its top-level `pollEnabled` flag) so the voted-cookie `afterChange` hook can skip a second form
 * fetch on the same request.
 */
export const POLL_CONTEXT_KEY = 'formBuilderPollConfig'

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
	const name = votedCookieName(formId)
	return cookieHeader.split(';').some((pair) => {
		const eq = pair.indexOf('=')
		return eq !== -1 && pair.slice(0, eq).trim() === name
	})
}
