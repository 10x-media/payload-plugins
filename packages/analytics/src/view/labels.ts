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
	search: keys.channelSearch,
	social: keys.channelSocial,
	email: keys.channelEmail,
	paid: keys.channelPaid,
	referral: keys.channelReferral,
}

const isTrafficChannel = (value: string): value is TrafficChannel =>
	(TRAFFIC_CHANNELS as readonly string[]).includes(value)

/**
 * A dimension value as it is shown. Only `source` holds a fixed set of buckets worth naming in
 * the reader's language; every other dimension, and any host a rollup written before `source`
 * became a channel still carries, reads as the value that was stored. The stored value is what
 * a filter and the URL keep, so only the display changes.
 */
export const valueLabel = (dimension: DimensionKey, value: string, t: Translate): string =>
	dimension === 'source' && isTrafficChannel(value) ? t(CHANNEL_LABELS[value]) : value
