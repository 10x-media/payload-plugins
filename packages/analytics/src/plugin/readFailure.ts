import { classifyError } from '../surfacing/classifyError'
import { analyticsError, errorResponse, retryAfter } from './errors'

/** What the endpoint says for a source whose host the install does not allow. */
export const HOST_REFUSED_MESSAGE =
	"analytics: this source's host is not one the install allows; list it in providers.hosts.allow, or set providers.hosts.allowPrivateNetwork for a private or http address"

/**
 * Answer for a failed read with nothing cached to serve. A misconfigured source (502) omits
 * `Retry-After` since waiting will not fix it; upstream error text never reaches the answer.
 */
export const readFailureResponse = (err: unknown): Response => {
	const failure = classifyError(err)
	switch (failure.kind) {
		case 'invalid_param':
			return errorResponse(
				400,
				analyticsError(
					'invalid_param',
					failure.message ?? 'analytics: the source refused this query as asked',
					failure.param ?? 'query'
				)
			)
		case 'source_misconfigured':
			return errorResponse(
				502,
				failure.hostRefused
					? analyticsError('source_misconfigured', HOST_REFUSED_MESSAGE, 'host')
					: analyticsError(
							'source_misconfigured',
							'analytics: this source is not set up correctly; check its settings',
							'source'
						)
			)
		case 'rate_limited':
			return errorResponse(
				429,
				analyticsError(
					'rate_limited',
					'analytics: too many reads are waiting on their sources for this scope; retry shortly'
				),
				retryAfter(failure.retryAfterMs)
			)
		case 'unavailable':
			return errorResponse(
				503,
				analyticsError('unavailable', 'analytics: source is temporarily unavailable'),
				retryAfter(failure.retryAfterMs)
			)
	}
}
