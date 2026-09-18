import type { DimensionKey, Granularity } from '../core/contract'
import { TRAFFIC_CHANNELS, type TrafficChannel } from '../native/ingest/source'
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
}

export const TAB_LABELS: Record<BreakdownTab, TranslationKey> = {
	pages: keys.viewTabPages,
	sources: keys.viewTabSources,
	technology: keys.viewTabTechnology,
	geography: keys.viewTabGeography,
	events: keys.viewTabEvents,
	goals: keys.goalsCollectionPlural,
}

/** The bucket the trend chart is drawn at, named in the chart's caption. */
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
	(TRAFFIC_CHANNELS as readonly string[]).includes(value)

export interface ValueLabelArgs {
	dimension: DimensionKey
	value: string
	/** The source that answered the read the value came from. */
	provider: string
	t: Translate
}

/** A row a source answered with no value for the dimension it was grouped by. */
export const isUnsetValue = (value: string): boolean => value.trim() === ''

/**
 * A dimension value as it is shown. Only the native engine's `channel` holds a fixed set of
 * buckets worth naming in the reader's language; a provider classifies into its own
 * vocabulary and its rows read raw. Native `source` names an origin rather than a channel,
 * so only its `direct` token translates: a row reading `email` there is a `utm_source` tag.
 * The stored value is what a filter and the URL keep, so only the display changes.
 */
export const valueLabel = ({ dimension, value, provider, t }: ValueLabelArgs): string => {
	// Any source can answer a row with no value (PostHog reports an empty channel for a
	// pageview outside a session), and an unlabeled bar reads as a missing row.
	if (isUnsetValue(value)) {
		return t(keys.valueNotSet)
	}
	if (provider !== 'native') {
		return value
	}
	if (dimension === 'channel' && isTrafficChannel(value)) {
		return t(CHANNEL_LABELS[value])
	}
	return dimension === 'source' && value === 'direct' ? t(keys.channelDirect) : value
}
