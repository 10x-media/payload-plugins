import type { DimensionKey, Granularity } from '../core/contract'
import { keys, type TranslationKey } from '../translations/keys'
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
