import type { AnalyticsResult } from '../core/contract'

/**
 * The share of a read's pageviews counted without consent, between 0 and 1; undefined when the
 * source reports none or the read has no pageview total to divide by.
 */
export const withoutConsentShare = (result: AnalyticsResult | undefined): number | undefined => {
	const counted = result?.meta.withoutConsent?.pageviews
	const pageviews = result?.totals?.pageviews
	if (
		typeof counted !== 'number' ||
		counted <= 0 ||
		typeof pageviews !== 'number' ||
		pageviews <= 0
	) {
		return undefined
	}
	// A source may count the two apart, so the share never reads above a whole.
	return Math.min(1, counted / pageviews)
}
