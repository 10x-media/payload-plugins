import { formatDuration } from '../fields/format'
import { keys } from '../translations/keys'
import type { Translate } from '../translations/server'

/** What a surface offers for a read that failed for now: the retry, and when it can succeed. */
export interface RetryOffer {
	label: string
	/** "Try again in 30 seconds.", when the source or the plugin said how long. */
	after?: string
}

/**
 * The retry a `busy` read offers, worded as the view words it; none for any other status, which
 * waiting does not change.
 */
export const retryOfferFor = (
	status: string,
	retryAfterMs: number | undefined,
	context: { t: Translate; locale: string }
): RetryOffer | undefined => {
	if (status !== 'busy') {
		return undefined
	}
	const { t, locale } = context
	return {
		label: t(keys.viewRetry),
		...(retryAfterMs === undefined
			? {}
			: { after: t(keys.viewErrorRetryAfter, { duration: formatDuration(retryAfterMs, locale) }) }),
	}
}
