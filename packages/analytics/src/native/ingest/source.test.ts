import { describe, expect, it } from 'vitest'
import { deriveSource, type SourceInput, TRAFFIC_CHANNELS, type TrafficChannel } from './source'

const CASES: ReadonlyArray<readonly [string, SourceInput, TrafficChannel]> = [
	['nothing at all', {}, 'direct'],
	['a same-site referrer, which reports no host', { referrerHost: undefined }, 'direct'],
	['an unknown referrer host', { referrerHost: 'news.ycombinator.com' }, 'referral'],

	['a search host', { referrerHost: 'bing.com' }, 'search'],
	['a search subdomain', { referrerHost: 'search.brave.com' }, 'search'],
	['google on any tld', { referrerHost: 'google.de' }, 'search'],
	['google on a two-label tld', { referrerHost: 'google.co.uk' }, 'search'],
	['a google subdomain', { referrerHost: 'news.google.com' }, 'search'],
	['yahoo on any tld', { referrerHost: 'search.yahoo.co.jp' }, 'search'],
	['yandex on any tld', { referrerHost: 'yandex.ru' }, 'search'],
	['a host that merely contains a search brand', { referrerHost: 'mygoogle.com' }, 'referral'],
	['a host that merely hosts a search brand', { referrerHost: 'google.evil.com' }, 'referral'],

	['a social host', { referrerHost: 'x.com' }, 'social'],
	['a social shortener', { referrerHost: 't.co' }, 'social'],
	['a social subdomain', { referrerHost: 'm.facebook.com' }, 'social'],
	['pinterest on any tld', { referrerHost: 'pinterest.co.uk' }, 'social'],

	['utm_medium cpc', { utmMedium: 'cpc' }, 'paid'],
	['utm_medium in caps', { utmMedium: 'CPC' }, 'paid'],
	['utm_medium with surrounding space', { utmMedium: '  Email  ' }, 'email'],
	['utm_medium newsletter', { utmMedium: 'newsletter' }, 'email'],
	['utm_medium social-media', { utmMedium: 'social-media' }, 'social'],
	['utm_medium sm', { utmMedium: 'sm' }, 'social'],
	['utm_medium organic', { utmMedium: 'organic' }, 'search'],
	['utm_medium referral', { utmMedium: 'referral' }, 'referral'],
	['utm_medium display', { utmMedium: 'display' }, 'paid'],
	['utm_medium retargeting', { utmMedium: 'retargeting' }, 'paid'],
	['utm_medium paid-social', { utmMedium: 'paid-social' }, 'paid'],
	['utm_medium paidsocial', { utmMedium: 'paidsocial' }, 'paid'],
	['utm_medium paid_social', { utmMedium: 'paid_social' }, 'paid'],

	['a gclid', { query: 'gclid=abc' }, 'paid'],
	['an fbclid', { query: 'utm_source=meta&fbclid=abc' }, 'paid'],
	['an msclkid', { query: 'msclkid=abc' }, 'paid'],
	['a ttclid', { query: 'ttclid=abc' }, 'paid'],
	['a click id in caps', { query: 'GCLID=abc' }, 'paid'],
	['a valueless click id', { query: 'gclid=' }, 'direct'],
	['a query carrying no click id', { query: 'utm_source=newsletter&page=2' }, 'direct'],

	[
		'utm_medium email against a search referrer',
		{ referrerHost: 'google.com', utmMedium: 'email', query: 'utm_medium=email' },
		'email',
	],
	[
		'a click id against a social referrer',
		{ referrerHost: 'facebook.com', query: 'gclid=abc' },
		'paid',
	],
	[
		'utm_medium winning over a click id',
		{ referrerHost: 'google.com', utmMedium: 'newsletter', query: 'gclid=abc' },
		'email',
	],
	[
		'an unrecognized utm_medium falling through to the referrer',
		{ referrerHost: 'google.com', utmMedium: 'partner-blog' },
		'search',
	],
	['an unrecognized utm_medium with no referrer', { utmMedium: 'partner-blog' }, 'direct'],
]

describe('deriveSource', () => {
	it.each(CASES)('classifies %s', (_label, input, expected) => {
		expect(deriveSource(input)).toBe(expected)
	})

	it('only ever answers a declared channel', () => {
		for (const [, input] of CASES) {
			expect(TRAFFIC_CHANNELS).toContain(deriveSource(input))
		}
	})
})
