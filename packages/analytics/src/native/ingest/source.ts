import { MAX_UTM_LENGTH } from './utm'

/**
 * Paid is split per platform rather than pooled: that is the split every vendor reports and the
 * one a budget question is asked in.
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
	/**
	 * The click id {@link clickIdOf} read out of the query, for a caller that kept it instead of
	 * the query (a stored hit). Wins over `query` when both are given.
	 */
	clickId?: string
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
 * Lookups here are `Map`s or `Set`s: keys come from the query, and an object literal answers
 * inherited members. `referral` is absent so a hit with no referrer stays `direct`.
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
 * Paid mediums and the platform each names. `null` ones (`cpc` runs on social and search alike)
 * leave the platform to the referrer, as does any other medium starting `paid`.
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
export const PAID_CLICK_IDS: ReadonlyMap<string, Platform> = new Map<string, Platform>([
	['gclid', 'search'],
	['gbraid', 'search'],
	['wbraid', 'search'],
	['msclkid', 'search'],
	['ttclid', 'social'],
])

/**
 * Facebook appends `fbclid` to every outbound link, organic included, so it proves the platform,
 * never the spend. It stands in only for a missing referrer (the in-app browser case).
 */
export const FACEBOOK_CLICK_ID = 'fbclid'

/**
 * Hosts the lists below would misfile. Webmail is `referral`, not `email`: a referrer proves a
 * mail client, never that the mail was the newsletter `email` claims credit for.
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
 * Suffixes a brand's country site sits under (`google.co.uk`); without them any two-label tail
 * would match, handing `google.evil.com` the search channel.
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
	paid?: Platform
	facebook: boolean
}

/**
 * Name of the query's click id: the first paid network's, else Facebook's. Only the name is kept,
 * so a stored hit can be classified again without its query.
 */
export const clickIdOf = (query: string | undefined): string | undefined => {
	if (!query) {
		return undefined
	}
	let facebook = false
	for (const [key, value] of new URLSearchParams(query)) {
		if (!value) {
			continue
		}
		const name = key.toLowerCase()
		if (PAID_CLICK_IDS.has(name)) {
			return name
		}
		facebook ||= name === FACEBOOK_CLICK_ID
	}
	return facebook ? FACEBOOK_CLICK_ID : undefined
}

const clicksOf = (clickId: string | undefined): ClickIds => {
	const name = clickId?.toLowerCase()
	return {
		paid: name === undefined ? undefined : PAID_CLICK_IDS.get(name),
		facebook: name === FACEBOOK_CLICK_ID,
	}
}

const paidChannel = (platform: Platform | null | undefined): TrafficChannel =>
	platform ? PAID_CHANNELS[platform] : 'paid-other'

/**
 * `utm_medium` wins (a campaign states its own channel), then a paid click id, then the platform of
 * the referrer host or `utm_source`. A remaining host is `referral`, none at all is `direct`.
 */
export const classifyChannel = ({
	referrerHost,
	utmSource,
	utmMedium,
	query,
	clickId,
}: ChannelInput): TrafficChannel => {
	const host = referrerHost?.trim().toLowerCase()
	const name = utmSource?.trim().toLowerCase()
	const medium = utmMedium?.trim().toLowerCase()
	const clicks = clicksOf(clickId ?? clickIdOf(query))
	const named = host ? hostPlatform(host) : name ? namePlatform(name) : undefined
	const platform = named ?? (!host && clicks.facebook ? 'social' : undefined)
	if (medium) {
		if (PAID_MEDIUMS.has(medium) || medium.startsWith('paid')) {
			return paidChannel(
				PAID_MEDIUMS.get(medium) ??
					clicks.paid ??
					platform ??
					(host && name ? namePlatform(name) : undefined)
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
 * `utm_source` (lowercased, capped), else referrer host, else `direct`, as Plausible and GA4 define
 * source. A campaign tagged `utm_source=direct` therefore shares the untagged `direct` bucket.
 */
export const deriveSource = ({ referrerHost, utmSource }: SourceInput): string => {
	const tagged = utmSource?.trim().toLowerCase().slice(0, MAX_UTM_LENGTH)
	return tagged || referrerHost || 'direct'
}
