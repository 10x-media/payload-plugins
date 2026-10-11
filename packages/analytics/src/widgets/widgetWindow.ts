import type { PayloadRequest } from 'payload'
import type { AnalyticsFilter, DateRange } from '../core/contract'
import { requestTimezone } from '../plugin/runtime'
import type { TimeframePreset } from '../timeframe/presets'
import { TIMEFRAME_KEYS } from '../translations/metricKeys'
import type { Translate } from '../translations/server'
import { captionWithFilter } from './filterCaption'
import { filterValueLabel, type LabelledRead } from './filterValueLabel'
import { formatRangeCaption, isUnreadableCustomRange, resolveCustomRange } from './range'
import type { WidgetRange } from './types'

/** The window a widget's settings name, as its read, caption and view link take it. */
export interface WidgetWindow {
	/** As saved, `custom` included, which the view link keeps. */
	saved: TimeframePreset | 'custom'
	/** The preset the read takes; a custom window passes its `range` beside it. */
	timeframe: TimeframePreset
	/** The reporting timezone, resolved ahead of the read only for a custom window. */
	timezone?: string
	range?: DateRange
	/** Both custom bounds are set, yet one names no real day: the card reads nothing. */
	unreadable: boolean
}

const DEFAULT_TIMEFRAME: TimeframePreset = 'last30days'

/**
 * A widget's saved window. A custom one needs the reporting timezone before the read to name its
 * days; a preset resolves it inside the read path.
 */
export const resolveWidgetWindow = async (
	req: PayloadRequest,
	data: { timeframe?: TimeframePreset | 'custom'; range?: WidgetRange }
): Promise<WidgetWindow> => {
	const saved = data.timeframe ?? DEFAULT_TIMEFRAME
	if (saved !== 'custom') {
		return { saved, timeframe: saved, unreadable: false }
	}
	const timezone = await requestTimezone(req)
	const range = resolveCustomRange(saved, data.range, timezone)
	return {
		saved,
		timeframe: DEFAULT_TIMEFRAME,
		timezone,
		...(range ? { range } : {}),
		unreadable: isUnreadableCustomRange(saved, data.range),
	}
}

/** The window as a widget read takes it. */
export const windowReadArgs = (
	window: WidgetWindow
): { timeframe: TimeframePreset; range?: DateRange; timezone?: string } => ({
	timeframe: window.timeframe,
	...(window.range ? { range: window.range } : {}),
	...(window.timezone ? { timezone: window.timezone } : {}),
})

/** The window as the card's caption names it: the custom days, else the preset's name. */
export const windowCaption = (window: WidgetWindow, locale: string, t: Translate): string =>
	window.range && window.timezone
		? formatRangeCaption(window.range, locale, window.timezone)
		: t(TIMEFRAME_KEYS[window.timeframe])

/** The card's caption: its window, then its filter with the value named as the view's chip names it. */
export const widgetCaption = async (
	req: PayloadRequest,
	args: {
		window: WidgetWindow
		filters: AnalyticsFilter[]
		read: LabelledRead
		locale: string
		t: Translate
	}
): Promise<string> => {
	const caption = windowCaption(args.window, args.locale, args.t)
	const filter = args.filters[0]
	if (!filter) {
		return caption
	}
	const shown = await filterValueLabel(req, filter, args.read)
	return captionWithFilter(caption, { ...filter, shown }, args.t)
}
