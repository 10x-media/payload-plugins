import { MAX_UTM_LENGTH } from './utm'

/**
 * Every acquisition channel the `channel` dimension can hold, lowercase as they are stored.
 * Paid is split per platform rather than pooled, because that is the split every vendor
 * reports and the one a budget question is actually asked in.
 */
export const TRAFFIC_CHANNELS = [
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
] as const

export type TrafficChannel = (typeof TRAFFIC_CHANNELS)[number]

/**
 * Stamped beside the channel on every event, so a later reclassify can find the rows an
 * older rule set decided. Bump it whenever these rules change what they answer.
 */
export const CHANNEL_TAXONOMY_VERSION = 1

export interface ChannelInput {
	/** The referrer's bare host from `referrerHost`, already absent for a same-site hit. */
	referrerHost?: string
	utmSource?: string
	utmMedium?: string
	/** The page's query string, read here only for the ad networks' click ids. */
	query?: string
}

export interface SourceInput {
	referrerHost?: string
	utmSource?: string
}

/** The platform families a referrer host or a `utm_source` is sorted into. */
type Platform = 'search' | 'social' | 'video'

const PAID_CHANNELS: Record<Platform, TrafficChannel> = {
	search: 'paid-search',
	social: 'paid-social',
	video: 'paid-video',
}

const ORGANIC_CHANNELS: Record<Platform, TrafficChannel> = {
	search: 'organic-search',
	social: 'organic-social',
	video: 'organic-video',
}

/**
 * Every lookup below is a `Map` or a `Set` rather than an object literal: each is keyed by
 * whatever `utm_medium`, `utm_source` or a query key carries, and an object literal answers
 * an inherited member, which would put a function where a channel belongs.
 *
 * `referral` is deliberately absent. It names the channel the host branch already decides,
 * and pinning it here would turn a hit with no referrer at all into `referral` rather than
 * `direct`.
 */
const MEDIUM_CHANNELS: ReadonlyMap<string, TrafficChannel> = new Map<string, TrafficChannel>([
	['email', 'email'],
	['newsletter', 'email'],
	['affiliate', 'affiliate'],
	['affiliates', 'affiliate'],
	['display', 'display'],
	['banner', 'display'],
	['cpm', 'display'],
	['retargeting', 'display'],
	['remarketing', 'display'],
	['social', 'organic-social'],
	['social-media', 'organic-social'],
	['sm', 'organic-social'],
	['organic', 'organic-search'],
	['search', 'organic-search'],
])

/**
 * Mediums that declare a paid visit, mapped to the platform the medium itself names. `null`
 * is a medium that says "paid" and nothing more: `cpc` is as common on a social buy as on a
 * search one, so it names no platform and leaves the referrer to. Any other medium starting
 * `paid` is treated the same way.
 */
const PAID_MEDIUMS: ReadonlyMap<string, Platform | null> = new Map<string, Platform | null>([
	['cpc', null],
	['ppc', null],
	['paidsearch', 'search'],
	['paid-search', 'search'],
	['paid_search', 'search'],
	['paidsocial', 'social'],
	['paid-social', 'social'],
	['paid_social', 'social'],
	['paidvideo', 'video'],
	['paid-video', 'video'],
	['paid_video', 'video'],
])

/** Click ids only a paid click carries, and the platform of the network that issues each. */
const PAID_CLICK_IDS: ReadonlyMap<string, Platform> = new Map<string, Platform>([
	['gclid', 'search'],
	['gbraid', 'search'],
	['wbraid', 'search'],
	['msclkid', 'search'],
	['ttclid', 'social'],
])

/**
 * Facebook appends `fbclid` to every outbound link, organic posts included, so it proves the
 * platform and never the spend. It stands in for a referrer only when there is none, which is
 * the in-app browser case it exists to cover.
 */
const FACEBOOK_CLICK_ID = 'fbclid'

/**
 * Hosts the lists below would get wrong, checked first and sorted into no platform at all.
 * Webmail is a `referral` rather than `email`: a referrer only proves a link was opened in a
 * mail client, never that the mail was the newsletter an `email` bucket claims credit for.
 */
const NON_PLATFORM_HOSTS: ReadonlySet<string> = new Set([
	'mail.google.com',
	'mail.yahoo.com',
	'outlook.live.com',
	'outlook.office.com',
	'mail.proton.me',
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
	'threads.net',
	'mastodon.social',
	'bsky.app',
	'web.telegram.org',
	't.me',
	'wa.me',
	'whatsapp.com',
]
const VIDEO_HOSTS = ['youtube.com', 'youtu.be', 'vimeo.com']

/** Brands running one site per country, matched on the label rather than a fixed tld. */
const SEARCH_BRANDS = ['google', 'yahoo', 'yandex']
const SOCIAL_BRANDS = ['pinterest']

/** The same platforms by name, for the `utm_source` a hit carries instead of a referrer. */
const NAME_PLATFORMS: ReadonlyMap<string, Platform> = new Map<string, Platform>([
	['google', 'search'],
	['bing', 'search'],
	['yahoo', 'search'],
	['yandex', 'search'],
	['duckduckgo', 'search'],
	['baidu', 'search'],
	['ecosia', 'search'],
	['brave', 'search'],
	['qwant', 'search'],
	['startpage', 'search'],
	['naver', 'search'],
	['seznam', 'search'],
	['sogou', 'search'],
	['facebook', 'social'],
	['fb', 'social'],
	['instagram', 'social'],
	['twitter', 'social'],
	['x', 'social'],
	['linkedin', 'social'],
	['reddit', 'social'],
	['tiktok', 'social'],
	['threads', 'social'],
	['mastodon', 'social'],
	['bluesky', 'social'],
	['bsky', 'social'],
	['telegram', 'social'],
	['whatsapp', 'social'],
	['pinterest', 'social'],
	['youtube', 'video'],
	['vimeo', 'video'],
])

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

const hostPlatform = (host: string): Platform | undefined => {
	for (const domain of NON_PLATFORM_HOSTS) {
		if (matchesHost(host, domain)) {
			return undefined
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
	if (VIDEO_HOSTS.some((domain) => matchesHost(host, domain))) {
		return 'video'
	}
	return undefined
}

/** A `utm_source` spelled as a domain is matched as one, so `google.com` is not an unknown. */
const namePlatform = (name: string): Platform | undefined =>
	NAME_PLATFORMS.get(name) ?? (name.includes('.') ? hostPlatform(name) : undefined)

interface ClickIds {
	/** The platform of the paid click id the query carried, if it carried one. */
	paid?: Platform
	facebook: boolean
}

const clickIds = (query: string | undefined): ClickIds => {
	if (!query) {
		return { facebook: false }
	}
	let paid: Platform | undefined
	let facebook = false
	for (const [key, value] of new URLSearchParams(query)) {
		if (!value) {
			continue
		}
		const name = key.toLowerCase()
		if (name === FACEBOOK_CLICK_ID) {
			facebook = true
			continue
		}
		paid ??= PAID_CLICK_IDS.get(name)
	}
	return { paid, facebook }
}

const paidChannel = (platform: Platform | null | undefined): TrafficChannel =>
	platform ? PAID_CHANNELS[platform] : 'paid-other'

/**
 * The acquisition channel a hit arrived through, which is what a report is asked for ("how
 * much of last month was paid search?"), where the origin it came from is the `source`
 * dimension's job.
 *
 * `utm_medium` wins outright, because a campaign states its own channel and the referrer host
 * is then only the last hop. A paid click id is next, since an ad click carries one whatever
 * host it bounced through, and it names its own network's platform. The platform itself comes
 * from the referrer host, else from `utm_source` matched by name; on the paid path `utm_source`
 * answers too when the host names no platform, because an ad click routinely arrives through the
 * network's own redirect host. Anything left with a host is `referral`, and a hit with no usable
 * host at all is `direct`.
 */
export const classifyChannel = ({
	referrerHost,
	utmSource,
	utmMedium,
	query,
}: ChannelInput): TrafficChannel => {
	const host = referrerHost?.trim().toLowerCase()
	const name = utmSource?.trim().toLowerCase()
	const medium = utmMedium?.trim().toLowerCase()
	const clicks = clickIds(query)
	const named = host ? hostPlatform(host) : name ? namePlatform(name) : undefined
	const platform = named ?? (!host && clicks.facebook ? 'social' : undefined)
	if (medium) {
		if (PAID_MEDIUMS.has(medium) || medium.startsWith('paid')) {
			return paidChannel(
				PAID_MEDIUMS.get(medium) ??
					clicks.paid ??
					platform ??
					(name ? namePlatform(name) : undefined)
			)
		}
		const channel = MEDIUM_CHANNELS.get(medium)
		if (channel) {
			return channel
		}
	}
	if (clicks.paid) {
		return paidChannel(clicks.paid)
	}
	if (platform) {
		return ORGANIC_CHANNELS[platform]
	}
	return host ? 'referral' : 'direct'
}

/**
 * The visit's named origin: the `utm_source` it was tagged with, else the host it came from,
 * else `direct`. That is what `source` means on Plausible (`visit:source`) and GA4
 * (`sessionSource`), so a report reads the same column whichever source answered it. The tag
 * keeps its case and is capped like every other campaign key; the host arrives lowercased. A
 * campaign tagged `utm_source=direct` therefore shares the `direct` bucket with untagged traffic.
 */
export const deriveSource = ({ referrerHost, utmSource }: SourceInput): string => {
	const tagged = utmSource?.trim().slice(0, MAX_UTM_LENGTH)
	return tagged || referrerHost || 'direct'
}
