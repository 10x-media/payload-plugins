import { describe, expect, it } from 'vitest'
import { clickIdOf, FACEBOOK_CLICK_ID, PAID_CLICK_IDS } from '../native/ingest/source'
import { extractUtm, UTM_KEYS } from '../native/ingest/utm'
import { MAX_QUERY_LENGTH } from '../query/limits'
import { CLICK_ID_PARAMS, campaignQuery, MAX_CAMPAIGN_VALUE_LENGTH, UTM_PARAMS } from './campaign'

describe('campaignQuery', () => {
	it('keeps the utm keys and the click id names, and nothing else of the address', () => {
		const query = campaignQuery(
			'utm_source=newsletter&email=a%40b.example&token=secret&gclid=Cj0KCQ-click&utm_medium=email'
		)

		expect(query).toBe('utm_source=newsletter&gclid=1&utm_medium=email')
		expect(query).not.toContain('secret')
		expect(query).not.toContain('Cj0KCQ')
	})

	it('extracts what ingest would have extracted from the whole query', () => {
		const search =
			'UTM_Source=%20Mail%20&utm_source=second&utm_campaign=&utm_campaign=spring+sale&fbclid=x&msclkid=y&ref=z'

		const sent = campaignQuery(search)

		expect(extractUtm(sent)).toEqual(extractUtm(search))
		expect(clickIdOf(sent)).toBe(clickIdOf(search))
		expect(clickIdOf(sent)).toBe('msclkid')
	})

	it('caps each value, and the whole query, as ingest does', () => {
		const long = 'x'.repeat(400)

		expect(campaignQuery(`utm_term=${long}`)).toBe(
			`utm_term=${'x'.repeat(MAX_CAMPAIGN_VALUE_LENGTH)}`
		)
		const many = campaignQuery(
			UTM_PARAMS.map((key) => `${key}=${'%E2%82%AC'.repeat(100)}`).join('&')
		)
		expect(many.length).toBeLessThanOrEqual(MAX_QUERY_LENGTH)
		expect(Object.keys(extractUtm(many)).length).toBeGreaterThan(0)
	})

	it('answers an empty string for an address with no campaign in it', () => {
		expect(campaignQuery('')).toBe('')
		expect(campaignQuery('page=2&gclid=')).toBe('')
	})

	it('names exactly the keys ingest reads', () => {
		expect([...UTM_KEYS.keys()].sort()).toEqual([...UTM_PARAMS].sort())
		expect([...PAID_CLICK_IDS.keys(), FACEBOOK_CLICK_ID].sort()).toEqual(
			[...CLICK_ID_PARAMS].sort()
		)
	})
})
