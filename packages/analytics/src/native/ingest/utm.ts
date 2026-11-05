import { MAX_CAMPAIGN_VALUE_LENGTH } from '../../tracker/campaign'

interface UtmParams {
	utmSource?: string
	utmMedium?: string
	utmCampaign?: string
	utmContent?: string
	utmTerm?: string
}

/** Each extracted value is one a breakdown groups by, so it is capped like every other one. */
export const MAX_UTM_LENGTH = MAX_CAMPAIGN_VALUE_LENGTH

/**
 * A `Map`, not an object literal: keys come from the query, and an object literal would answer
 * inherited members, so `?constructor=x` would reach storage.
 */
export const UTM_KEYS: ReadonlyMap<string, keyof UtmParams> = new Map<string, keyof UtmParams>([
	['utm_source', 'utmSource'],
	['utm_medium', 'utmMedium'],
	['utm_campaign', 'utmCampaign'],
	['utm_content', 'utmContent'],
	['utm_term', 'utmTerm'],
])

/**
 * The five utm keys of a query, decoded and capped; a repeated key keeps its first value, as
 * `URLSearchParams.get` would. The rest of the query never reaches storage.
 */
export const extractUtm = (query: string | undefined): UtmParams => {
	if (!query) {
		return {}
	}
	const out: UtmParams = {}
	for (const [rawKey, rawValue] of new URLSearchParams(query)) {
		const key = UTM_KEYS.get(rawKey.toLowerCase())
		if (!key || out[key] !== undefined) {
			continue
		}
		const value = rawValue.trim().slice(0, MAX_UTM_LENGTH)
		if (value) {
			out[key] = value
		}
	}
	return out
}
