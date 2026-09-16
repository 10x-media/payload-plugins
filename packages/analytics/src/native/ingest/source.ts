/** Every bucket the `source` dimension can hold, lowercase as they are stored. */
export const TRAFFIC_CHANNELS = ['direct', 'search', 'social', 'email', 'paid', 'referral'] as const

export type TrafficChannel = (typeof TRAFFIC_CHANNELS)[number]

export interface SourceInput {
	/** The referrer's bare host from `referrerHost`, already absent for a same-site hit. */
	referrerHost?: string
	utmMedium?: string
	/** The page's query string, read here only for the ad networks' click ids. */
	query?: string
}

/**
 * A `Map` rather than an object literal: a lookup keyed by whatever `utm_medium` carries must
 * answer nothing for `constructor` or `__proto__`, where an object literal answers an
 * inherited member and puts a function in the `source` column.
 *
 * `referral` is deliberately absent. It names the channel the host branch already decides, and
 * pinning it here would turn a hit with no referrer at all into `referral` rather than `direct`.
 */
const MEDIUM_CHANNELS: ReadonlyMap<string, TrafficChannel> = new Map<string, TrafficChannel>([
	['cpc', 'paid'],
	['ppc', 'paid'],
	['display', 'paid'],
	['retargeting', 'paid'],
	['email', 'email'],
	['newsletter', 'email'],
	['social', 'social'],
	['social-media', 'social'],
	['sm', 'social'],
	['organic', 'search'],
	['search', 'search'],
])

/** A click id only an ad click carries, whatever the referrer says. */
const CLICK_IDS: ReadonlySet<string> = new Set(['gclid', 'fbclid', 'msclkid', 'ttclid'])

/**
 * Hosts whose channel the lists below would get wrong, checked first. Webmail is `referral`
 * rather than `email`: a referrer only proves a link was opened in a mail client, never that
 * the mail was the newsletter an `email` bucket claims credit for.
 */
const HOST_OVERRIDES: ReadonlyMap<string, TrafficChannel> = new Map<string, TrafficChannel>([
	['mail.google.com', 'referral'],
	['mail.yahoo.com', 'referral'],
	['outlook.live.com', 'referral'],
	['outlook.office.com', 'referral'],
	['mail.proton.me', 'referral'],
])

const SEARCH_HOSTS = [
	'bing.com',
	'duckduckgo.com',
	'baidu.com',
	'ecosia.org',
	'search.brave.com',
	'qwant.com',
	'startpage.com',
	'naver.com',
	'seznam.cz',
	'sogou.com',
]
const SOCIAL_HOSTS = [
	'facebook.com',
	'fb.com',
	'instagram.com',
	'twitter.com',
	'x.com',
	't.co',
	'linkedin.com',
	'lnkd.in',
	'reddit.com',
	'tiktok.com',
	'youtube.com',
	'youtu.be',
	'threads.net',
	'mastodon.social',
	'bsky.app',
	'web.telegram.org',
	't.me',
	'wa.me',
	'whatsapp.com',
]

/** Brands running one site per country, matched on the label rather than a fixed tld. */
const SEARCH_BRANDS = ['google', 'yahoo', 'yandex']
const SOCIAL_BRANDS = ['pinterest']

/**
 * Second-level suffixes a brand's country site sits under (`google.co.uk`, `yahoo.com.au`).
 * Without this list a two-label tail would also match `google.evil.com`, handing any host that
 * cares to name itself after a search engine the search channel.
 */
const SECOND_LEVEL: ReadonlySet<string> = new Set(['co', 'com', 'net', 'org', 'ac', 'gov', 'edu'])

const matchesHost = (host: string, domain: string): boolean =>
	host === domain || host.endsWith(`.${domain}`)

const matchesBrand = (host: string, brand: string): boolean => {
	const labels = host.split('.')
	for (let i = 0; i < labels.length; i++) {
		if (labels[i] !== brand) {
			continue
		}
		const tail = labels.length - i - 1
		if (tail === 1 || (tail === 2 && SECOND_LEVEL.has(labels[i + 1] ?? ''))) {
			return true
		}
	}
	return false
}

const hostChannel = (host: string): TrafficChannel => {
	for (const [domain, channel] of HOST_OVERRIDES) {
		if (matchesHost(host, domain)) {
			return channel
		}
	}
	if (
		SEARCH_HOSTS.some((domain) => matchesHost(host, domain)) ||
		SEARCH_BRANDS.some((brand) => matchesBrand(host, brand))
	) {
		return 'search'
	}
	if (
		SOCIAL_HOSTS.some((domain) => matchesHost(host, domain)) ||
		SOCIAL_BRANDS.some((brand) => matchesBrand(host, brand))
	) {
		return 'social'
	}
	return 'referral'
}

const hasClickId = (query: string): boolean => {
	for (const [key, value] of new URLSearchParams(query)) {
		if (value && CLICK_IDS.has(key.toLowerCase())) {
			return true
		}
	}
	return false
}

/**
 * The `source` dimension's bucket: the traffic channel a hit arrived through, which is what a
 * report is asked for ("how much of last month was paid?"), where the host it came from is the
 * `referrer` dimension's job.
 *
 * `utm_medium` wins outright, because a campaign states its own channel and the referrer host
 * is then only the last hop; a paid click id is next, since an ad click carries one whatever
 * host it bounced through; the built-in search and social lists decide the rest. Anything else
 * with a host is `referral`, and a hit with no usable host at all is `direct`.
 */
export const deriveSource = ({ referrerHost, utmMedium, query }: SourceInput): TrafficChannel => {
	const medium = utmMedium?.trim().toLowerCase()
	if (medium) {
		const channel = medium.startsWith('paid') ? 'paid' : MEDIUM_CHANNELS.get(medium)
		if (channel) {
			return channel
		}
	}
	if (query && hasClickId(query)) {
		return 'paid'
	}
	return referrerHost ? hostChannel(referrerHost) : 'direct'
}
