import type { DimensionKey, Granularity } from '../core/contract'
import { TRAFFIC_CHANNELS, type TrafficChannel } from '../native/ingest/source'
import type { ItemLabels } from '../query/response'
import { displayNames } from '../translations/intl'
import { keys, type TranslationKey } from '../translations/keys'
import type { Translate } from '../translations/server'
import type { BreakdownTab } from './gating'

/** Column headers and filter chips name the dimension, so every contract key has a label. */
export const DIMENSION_LABELS: Record<DimensionKey, TranslationKey> = {
	page: keys.viewDimensionPage,
	referrer: keys.viewDimensionReferrer,
	source: keys.viewDimensionSource,
	channel: keys.viewDimensionChannel,
	medium: keys.viewDimensionMedium,
	campaign: keys.viewDimensionCampaign,
	utmSource: keys.viewDimensionUtmSource,
	utmMedium: keys.viewDimensionUtmMedium,
	utmCampaign: keys.viewDimensionUtmCampaign,
	utmContent: keys.viewDimensionUtmContent,
	utmTerm: keys.viewDimensionUtmTerm,
	device: keys.viewDimensionDevice,
	browser: keys.viewDimensionBrowser,
	os: keys.viewDimensionOs,
	country: keys.viewDimensionCountry,
	region: keys.viewDimensionRegion,
	city: keys.viewDimensionCity,
	language: keys.viewDimensionLanguage,
	event: keys.viewDimensionEvent,
	goal: keys.viewDimensionGoal,
	currency: keys.viewDimensionCurrency,
	item: keys.viewDimensionItem,
}

export const TAB_LABELS: Record<BreakdownTab, TranslationKey> = {
	pages: keys.viewTabPages,
	content: keys.viewTabContent,
	sources: keys.viewTabSources,
	technology: keys.viewTabTechnology,
	geography: keys.viewTabGeography,
	events: keys.viewTabEvents,
	goals: keys.goalsCollectionPlural,
}

export const GRANULARITY_LABELS: Record<Granularity, TranslationKey> = {
	minute: keys.viewGranularityMinute,
	hour: keys.viewGranularityHour,
	day: keys.viewGranularityDay,
	week: keys.viewGranularityWeek,
	month: keys.viewGranularityMonth,
}

export const CHANNEL_LABELS: Record<TrafficChannel, TranslationKey> = {
	direct: keys.channelDirect,
	'organic-search': keys.channelOrganicSearch,
	'paid-search': keys.channelPaidSearch,
	'organic-social': keys.channelOrganicSocial,
	'paid-social': keys.channelPaidSocial,
	'organic-video': keys.channelOrganicVideo,
	'paid-video': keys.channelPaidVideo,
	email: keys.channelEmail,
	affiliate: keys.channelAffiliate,
	display: keys.channelDisplay,
	referral: keys.channelReferral,
	'paid-other': keys.channelPaidOther,
}

const isTrafficChannel = (value: string): value is TrafficChannel =>
	TRAFFIC_CHANNELS.some((channel) => channel === value)

/**
 * Device, browser and OS tokens worth naming, keyed with spacing and casing removed so native's
 * `macos` and a provider's `macOS` share a row; anything absent reads as the source sent it.
 */
const TOKEN_LABELS: Record<'device' | 'browser' | 'os', Map<string, TranslationKey>> = {
	device: new Map([
		['desktop', keys.valueDeviceDesktop],
		['mobile', keys.valueDeviceMobile],
		['tablet', keys.valueDeviceTablet],
	]),
	browser: new Map([
		['chrome', keys.valueBrowserChrome],
		['googlechrome', keys.valueBrowserChrome],
		['safari', keys.valueBrowserSafari],
		['mobilesafari', keys.valueBrowserSafari],
		['firefox', keys.valueBrowserFirefox],
		['mozillafirefox', keys.valueBrowserFirefox],
		['edge', keys.valueBrowserEdge],
		['microsoftedge', keys.valueBrowserEdge],
		['opera', keys.valueBrowserOpera],
		['samsung', keys.valueBrowserSamsung],
		['samsunginternet', keys.valueBrowserSamsung],
		['other', keys.valueOther],
	]),
	os: new Map([
		['ios', keys.valueOsIos],
		['android', keys.valueOsAndroid],
		['windows', keys.valueOsWindows],
		['macos', keys.valueOsMacos],
		['macosx', keys.valueOsMacos],
		['osx', keys.valueOsMacos],
		['mac', keys.valueOsMacos],
		['linux', keys.valueOsLinux],
		['chromeos', keys.valueOsChromeos],
		['other', keys.valueOther],
	]),
}

const tokenKey = (value: string): string => value.toLowerCase().replace(/[\s._-]+/g, '')

/** A row a source answered with no value for the dimension it was grouped by. */
export const isUnsetValue = (value: string): boolean => value.trim() === ''

const COUNTRY_CODE = /^[A-Z]{2}$/

/**
 * A stored country value as an ISO 3166-1 alpha-2 code, or null when it is not one, so a
 * provider answering a name rather than a code gets no flag rather than a wrong one.
 */
export const countryCode = (value: string): string | null => {
	const upper = value.trim().toUpperCase()
	return COUNTRY_CODE.test(upper) ? upper : null
}

/**
 * BCP 47 tag with its region subtag upper-cased, which `Intl.DisplayNames` matches on; native
 * ingest lowercases the whole tag, so regional variants would otherwise read raw.
 */
const normalizeLanguageTag = (value: string): string => {
	const parts = value.trim().split('-')
	return parts
		.map((part, index) => (index > 0 && part.length === 2 ? part.toUpperCase() : part))
		.join('-')
}

/**
 * A region or language code as `locale` names it; undefined where the runtime names none or throws
 * on a malformed code.
 */
const displayNameOf = (
	type: 'region' | 'language',
	code: string,
	locale: string | undefined
): string | undefined => {
	try {
		return displayNames(locale, { type })?.of(code)
	} catch {
		return undefined
	}
}

export interface ValueLabelArgs {
	dimension: DimensionKey
	value: string
	/** The source that answered the read the value came from. */
	provider: string
	t: Translate
	/** Admin UI language the country and language names are read in. */
	locale?: string
	/** The scope's goals, so a `goal` row reads as its name rather than its slug. */
	goals?: ReadonlyArray<{ slug: string; name: string }>
	/**
	 * The titles the server resolved for item refs. Absent means none has arrived yet; a ref it
	 * holds no title for is a removed or hidden item.
	 */
	itemLabels?: ItemLabels
}

/**
 * An item ref as it is shown: its document's title, or a plain notice for one that is gone or
 * hidden from the reader. Never the ref itself, which names nothing a reader would recognize.
 */
export const itemLabel = (value: string, labels: ItemLabels | undefined, t: Translate): string => {
	if (labels === undefined) {
		return t(keys.valueLoading)
	}
	const title = labels[value]
	return typeof title === 'string' ? title : t(keys.itemRemoved)
}

/**
 * Dimension value as shown (display only). Country, language, device, browser and OS translate for
 * any source; of `channel` and `source`, only native buckets and native `direct` do.
 */
export const valueLabel = ({
	dimension,
	value,
	provider,
	t,
	locale,
	goals,
	itemLabels,
}: ValueLabelArgs): string => {
	// Any source can answer a row with no value (PostHog reports an empty channel for a
	// pageview outside a session), and an unlabeled bar reads as a missing row.
	if (isUnsetValue(value)) {
		return t(keys.valueNotSet)
	}
	if (dimension === 'item') {
		return itemLabel(value, itemLabels, t)
	}
	if (dimension === 'goal') {
		return goals?.find((goal) => goal.slug === value)?.name ?? value
	}
	if (dimension === 'country') {
		const code = countryCode(value)
		return code === null ? value : (displayNameOf('region', code, locale) ?? value)
	}
	if (dimension === 'language') {
		return displayNameOf('language', normalizeLanguageTag(value), locale) ?? value
	}
	if (dimension === 'device' || dimension === 'browser' || dimension === 'os') {
		const key = TOKEN_LABELS[dimension].get(tokenKey(value))
		return key === undefined ? value : t(key)
	}
	if (provider !== 'native') {
		return value
	}
	if (dimension === 'channel' && isTrafficChannel(value)) {
		return t(CHANNEL_LABELS[value])
	}
	return dimension === 'source' && value === 'direct' ? t(keys.channelDirect) : value
}
