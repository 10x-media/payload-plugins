export interface UtmParams {
	utmSource?: string
	utmMedium?: string
	utmCampaign?: string
	utmContent?: string
	utmTerm?: string
}

/** Each extracted value is a rollup bucket key, so it is capped like every other one. */
export const MAX_UTM_LENGTH = 128

const UTM_KEYS: Readonly<Record<string, keyof UtmParams>> = {
	utm_source: 'utmSource',
	utm_medium: 'utmMedium',
	utm_campaign: 'utmCampaign',
	utm_content: 'utmContent',
	utm_term: 'utmTerm',
}

/**
 * The five utm keys carried by a page's query string, decoded and capped. Keys are matched
 * case-insensitively and a repeated key keeps its first value, matching what
 * `URLSearchParams.get` would have answered. Everything else in the query is discarded here
 * and never reaches storage.
 */
export const extractUtm = (query: string | undefined): UtmParams => {
	if (!query) {
		return {}
	}
	const out: UtmParams = {}
	for (const [rawKey, rawValue] of new URLSearchParams(query)) {
		const key = UTM_KEYS[rawKey.toLowerCase()]
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
