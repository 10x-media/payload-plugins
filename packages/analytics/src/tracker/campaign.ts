import { MAX_QUERY_LENGTH } from '../query/limits'

/** The campaign keys ingest reads out of a page's query, matched without regard to case. */
export const UTM_PARAMS = [
	'utm_source',
	'utm_medium',
	'utm_campaign',
	'utm_content',
	'utm_term',
] as const

/** The ad click ids a visit's channel is classified by. Ingest reads their names, never their values. */
export const CLICK_ID_PARAMS = ['gclid', 'gbraid', 'wbraid', 'msclkid', 'ttclid', 'fbclid'] as const

/** Each campaign value ingest keeps is capped at this many characters. */
export const MAX_CAMPAIGN_VALUE_LENGTH = 128

const UTM: ReadonlySet<string> = new Set(UTM_PARAMS)

const CLICK_IDS: ReadonlySet<string> = new Set(CLICK_ID_PARAMS)

const encodePair = (key: string, value: string): string =>
	new URLSearchParams([[key, value]]).toString()

/**
 * The part of a page's query ingest reads: each utm key's first non-empty value, capped, and each
 * click id by name with a placeholder value. Nothing else in the address leaves the page.
 */
export const campaignQuery = (search: string): string => {
	const seen = new Set<string>()
	const pairs: string[] = []
	let length = 0
	for (const [rawKey, rawValue] of new URLSearchParams(search)) {
		const key = rawKey.toLowerCase()
		if (seen.has(key)) {
			continue
		}
		let value = UTM.has(key)
			? rawValue.trim().slice(0, MAX_CAMPAIGN_VALUE_LENGTH)
			: CLICK_IDS.has(key) && rawValue !== ''
				? '1'
				: ''
		if (value === '') {
			continue
		}
		seen.add(key)
		const room = MAX_QUERY_LENGTH - length - (pairs.length > 0 ? 1 : 0)
		let pair = encodePair(key, value)
		while (pair.length > room && value.length > 1) {
			value = value.slice(0, -1)
			pair = encodePair(key, value)
		}
		if (pair.length <= room) {
			pairs.push(pair)
			length += pair.length + (pairs.length > 1 ? 1 : 0)
		}
	}
	return pairs.join('&')
}
