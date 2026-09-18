import { describe, expect, it } from 'vitest'
import {
	type ChannelInput,
	classifyChannel,
	deriveSource,
	type SourceInput,
	TRAFFIC_CHANNELS,
	type TrafficChannel,
} from './source'

const CASES: ReadonlyArray<readonly [string, ChannelInput, TrafficChannel]> = [
	['nothing at all', {}, 'direct'],
	['a same-site referrer, which reports no host', { referrerHost: undefined }, 'direct'],
	['an unknown referrer host', { referrerHost: 'news.ycombinator.com' }, 'referral'],

	['a search host', { referrerHost: 'bing.com' }, 'organic-search'],
	['a search subdomain', { referrerHost: 'search.brave.com' }, 'organic-search'],
	['google on any tld', { referrerHost: 'google.de' }, 'organic-search'],
	['google on a two-label tld', { referrerHost: 'google.co.uk' }, 'organic-search'],
	['a google subdomain', { referrerHost: 'news.google.com' }, 'organic-search'],
	['yahoo on any tld', { referrerHost: 'search.yahoo.co.jp' }, 'organic-search'],
	['yandex on any tld', { referrerHost: 'yandex.ru' }, 'organic-search'],
	['a host that merely contains a search brand', { referrerHost: 'mygoogle.com' }, 'referral'],
	['a host that merely hosts a search brand', { referrerHost: 'google.evil.com' }, 'referral'],
	[
		'a search brand under a second level of somebody else',
		{ referrerHost: 'google.com.evil.io' },
		'referral',
	],
	['naver', { referrerHost: 'naver.com' }, 'organic-search'],
	['seznam', { referrerHost: 'search.seznam.cz' }, 'organic-search'],
	['sogou', { referrerHost: 'sogou.com' }, 'organic-search'],

	['a social host', { referrerHost: 'x.com' }, 'organic-social'],
	['a social shortener', { referrerHost: 't.co' }, 'organic-social'],
	['a social subdomain', { referrerHost: 'm.facebook.com' }, 'organic-social'],
	['pinterest on any tld', { referrerHost: 'pinterest.co.uk' }, 'organic-social'],
	['the linkedin shortener', { referrerHost: 'lnkd.in' }, 'organic-social'],
	['telegram web', { referrerHost: 'web.telegram.org' }, 'organic-social'],
	['the telegram shortener', { referrerHost: 't.me' }, 'organic-social'],
	['the whatsapp shortener', { referrerHost: 'wa.me' }, 'organic-social'],
	['whatsapp web', { referrerHost: 'web.whatsapp.com' }, 'organic-social'],

	['youtube, which is video rather than social', { referrerHost: 'youtube.com' }, 'organic-video'],
	['the youtube shortener', { referrerHost: 'youtu.be' }, 'organic-video'],
	['a youtube subdomain', { referrerHost: 'm.youtube.com' }, 'organic-video'],
	['vimeo', { referrerHost: 'vimeo.com' }, 'organic-video'],

	[
		'gmail, which the google brand would otherwise claim',
		{ referrerHost: 'mail.google.com' },
		'referral',
	],
	[
		'yahoo mail, which the yahoo brand would otherwise claim',
		{ referrerHost: 'mail.yahoo.com' },
		'referral',
	],
	['outlook.com', { referrerHost: 'outlook.live.com' }, 'referral'],
	['outlook for work', { referrerHost: 'outlook.office.com' }, 'referral'],
	['proton mail', { referrerHost: 'mail.proton.me' }, 'referral'],

	['utm_medium cpc with nothing to name a platform', { utmMedium: 'cpc' }, 'paid-other'],
	[
		'utm_medium cpc against an unknown host',
		{ referrerHost: 'ads.example', utmMedium: 'cpc' },
		'paid-other',
	],
	['utm_medium in caps', { utmMedium: 'CPC' }, 'paid-other'],
	[
		'utm_medium cpc against a search referrer',
		{ referrerHost: 'bing.com', utmMedium: 'cpc' },
		'paid-search',
	],
	[
		'utm_medium cpc against a social referrer',
		{ referrerHost: 'facebook.com', utmMedium: 'cpc' },
		'paid-social',
	],
	[
		'utm_medium cpc against a video referrer',
		{ referrerHost: 'youtube.com', utmMedium: 'cpc' },
		'paid-video',
	],
	['utm_medium ppc', { referrerHost: 'google.com', utmMedium: 'ppc' }, 'paid-search'],
	['utm_medium paid-search naming its own platform', { utmMedium: 'paid-search' }, 'paid-search'],
	['utm_medium paidsearch naming its own platform', { utmMedium: 'paidsearch' }, 'paid-search'],
	['utm_medium paid-social naming its own platform', { utmMedium: 'paid-social' }, 'paid-social'],
	['utm_medium paidsocial naming its own platform', { utmMedium: 'paidsocial' }, 'paid-social'],
	['utm_medium paid_social naming its own platform', { utmMedium: 'paid_social' }, 'paid-social'],
	['utm_medium paid-video naming its own platform', { utmMedium: 'paid-video' }, 'paid-video'],
	['an unrecognized paid medium', { utmMedium: 'paid-partnership' }, 'paid-other'],
	[
		'a medium naming its platform against a referrer naming another',
		{ referrerHost: 'google.com', utmMedium: 'paid-social' },
		'paid-social',
	],

	['utm_medium with surrounding space', { utmMedium: '  Email  ' }, 'email'],
	['utm_medium newsletter', { utmMedium: 'newsletter' }, 'email'],
	['utm_medium affiliate', { utmMedium: 'affiliate' }, 'affiliate'],
	['utm_medium affiliates', { utmMedium: 'affiliates' }, 'affiliate'],
	['utm_medium display', { utmMedium: 'display' }, 'display'],
	['utm_medium banner', { utmMedium: 'banner' }, 'display'],
	['utm_medium cpm', { utmMedium: 'cpm' }, 'display'],
	['utm_medium retargeting', { utmMedium: 'retargeting' }, 'display'],
	['utm_medium remarketing', { utmMedium: 'remarketing' }, 'display'],
	['utm_medium social-media', { utmMedium: 'social-media' }, 'organic-social'],
	['utm_medium sm', { utmMedium: 'sm' }, 'organic-social'],
	['utm_medium organic', { utmMedium: 'organic' }, 'organic-search'],
	['utm_medium search', { utmMedium: 'search' }, 'organic-search'],
	[
		'utm_medium referral against a host, which is the branch that decides it',
		{ referrerHost: 'news.ycombinator.com', utmMedium: 'referral' },
		'referral',
	],
	['utm_medium referral with no host to refer from', { utmMedium: 'referral' }, 'direct'],

	['a gclid', { query: 'gclid=abc' }, 'paid-search'],
	['a gbraid', { query: 'gbraid=abc' }, 'paid-search'],
	['a wbraid', { query: 'wbraid=abc' }, 'paid-search'],
	['an msclkid', { query: 'msclkid=abc' }, 'paid-search'],
	['a ttclid', { query: 'ttclid=abc' }, 'paid-social'],
	['a click id in caps', { query: 'GCLID=abc' }, 'paid-search'],
	['a valueless click id', { query: 'gclid=' }, 'direct'],
	['a query carrying no click id', { query: 'utm_source=newsletter&page=2' }, 'direct'],
	[
		'a google click id against a social referrer, since the ad network names the channel',
		{ referrerHost: 'facebook.com', query: 'gclid=abc' },
		'paid-search',
	],
	[
		'a tiktok click id against a search referrer',
		{ referrerHost: 'google.com', query: 'ttclid=abc' },
		'paid-social',
	],

	[
		'an fbclid alone, since an in-app browser strips the referrer',
		{ query: 'fbclid=abc' },
		'organic-social',
	],
	[
		'an fbclid against a search referrer, which outranks it',
		{ referrerHost: 'google.com', query: 'fbclid=abc' },
		'organic-search',
	],
	[
		'an fbclid against a paid medium, which Facebook appends to organic links too',
		{ utmMedium: 'cpc', query: 'fbclid=abc' },
		'paid-social',
	],
	[
		'an fbclid against an unknown referrer, which is a referral and not a social hit',
		{ referrerHost: 'news.ycombinator.com', query: 'fbclid=abc' },
		'referral',
	],

	[
		'utm_source naming a search platform with a paid medium and no referrer',
		{ utmSource: 'google', utmMedium: 'cpc' },
		'paid-search',
	],
	[
		'utm_source naming the search platform behind an ad network redirect',
		{ referrerHost: 'ads.example', utmSource: 'google', utmMedium: 'cpc' },
		'paid-search',
	],
	[
		'utm_source naming the social platform behind an ad network redirect',
		{ referrerHost: 'ads.example', utmSource: 'facebook', utmMedium: 'cpc' },
		'paid-social',
	],
	[
		'utm_source naming the video platform behind an ad network redirect',
		{ referrerHost: 'ads.example', utmSource: 'youtube', utmMedium: 'cpc' },
		'paid-video',
	],
	[
		'a referrer host naming a platform over a paid utm_source naming another',
		{ referrerHost: 'facebook.com', utmSource: 'google', utmMedium: 'cpc' },
		'paid-social',
	],
	['utm_source naming a search platform', { utmSource: 'duckduckgo' }, 'organic-search'],
	['utm_source naming a social platform', { utmSource: 'Facebook' }, 'organic-social'],
	['utm_source naming a video platform', { utmSource: 'youtube' }, 'organic-video'],
	['utm_source spelled as a host', { utmSource: 'google.com' }, 'organic-search'],
	[
		'utm_source losing to the referrer host, which is the hop that actually happened',
		{ referrerHost: 'news.ycombinator.com', utmSource: 'google' },
		'referral',
	],
	['an unlisted utm_source', { utmSource: 'partner-blog' }, 'direct'],

	[
		'utm_medium email against a search referrer',
		{ referrerHost: 'google.com', utmMedium: 'email', query: 'utm_medium=email' },
		'email',
	],
	[
		'utm_medium winning over a click id',
		{ referrerHost: 'google.com', utmMedium: 'newsletter', query: 'gclid=abc' },
		'email',
	],
	[
		'an unrecognized utm_medium falling through to the referrer',
		{ referrerHost: 'google.com', utmMedium: 'partner-blog' },
		'organic-search',
	],
	['an unrecognized utm_medium with no referrer', { utmMedium: 'partner-blog' }, 'direct'],

	['utm_medium constructor', { utmMedium: 'constructor' }, 'direct'],
	['utm_medium __proto__', { utmMedium: '__proto__' }, 'direct'],
	['utm_source constructor', { utmSource: 'constructor' }, 'direct'],
	['utm_source __proto__', { utmSource: '__proto__' }, 'direct'],
	['utm_source toString', { utmSource: 'toString' }, 'direct'],
	[
		'utm_medium toString against a host',
		{ referrerHost: 'bing.com', utmMedium: 'toString' },
		'organic-search',
	],
	[
		'utm_medium hasOwnProperty against a host',
		{ referrerHost: 'news.ycombinator.com', utmMedium: 'hasOwnProperty' },
		'referral',
	],
	['a prototype-named click id', { query: 'constructor=abc' }, 'direct'],
]

describe('classifyChannel', () => {
	it.each(CASES)('classifies %s', (_label, input, expected) => {
		expect(classifyChannel(input)).toBe(expected)
	})

	it('only ever answers a declared channel', () => {
		for (const [, input] of CASES) {
			expect(TRAFFIC_CHANNELS).toContain(classifyChannel(input))
		}
	})

	it('separates paid from organic on every platform it knows', () => {
		expect(TRAFFIC_CHANNELS).toEqual([
			'direct',
			'organic-search',
			'paid-search',
			'organic-social',
			'paid-social',
			'organic-video',
			'paid-video',
			'email',
			'affiliate',
			'display',
			'referral',
			'paid-other',
		])
	})
})

const SOURCE_CASES: ReadonlyArray<readonly [string, SourceInput, string]> = [
	['nothing at all as direct', {}, 'direct'],
	[
		'the referrer host when nothing is tagged',
		{ referrerHost: 'news.ycombinator.com' },
		'news.ycombinator.com',
	],
	[
		'the utm_source over the referrer host',
		{ referrerHost: 'google.com', utmSource: 'newsletter' },
		'newsletter',
	],
	[
		'the utm_source lowercased, so one tag spelled two ways is one row',
		{ utmSource: 'Newsletter' },
		'newsletter',
	],
	['a padded utm_source trimmed', { utmSource: '  newsletter  ' }, 'newsletter'],
	['an empty utm_source as absent', { referrerHost: 'google.com', utmSource: '   ' }, 'google.com'],
	['a prototype-named utm_source as itself', { utmSource: '__proto__' }, '__proto__'],
]

describe('deriveSource', () => {
	it.each(SOURCE_CASES)('reports %s', (_label, input, expected) => {
		expect(deriveSource(input)).toBe(expected)
	})

	it('caps an over-long utm_source at the same length the other campaign keys keep', () => {
		expect(deriveSource({ utmSource: 'a'.repeat(200) })).toHaveLength(128)
	})
})
