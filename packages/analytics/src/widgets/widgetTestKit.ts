import type { Payload, PayloadRequest } from 'payload'
import type { AnalyticsAdapter } from '../core/contract'
import { createRegistry } from '../core/registry'
import { type AnalyticsRuntime, setRuntime } from '../plugin/runtime'
import { en } from '../translations/en'
import { keys } from '../translations/keys'

// Shared by the widget specs alone; nothing the package ships imports it.

/** The view a widget links into, defaulting to what the plugin itself defaults to. */
export const TEST_VIEW = {
	path: '/analytics',
	defaultRange: 'last30days',
	defaultMetric: 'pageviews',
} as const

/** The first link's `href` in rendered markup, entities decoded. */
export const hrefIn = (html: string): string | undefined =>
	html.match(/<a[^>]+href="([^"]+)"/)?.[1]?.replaceAll('&amp;', '&')

const CAPTION_TEMPLATES: Record<string, string> = {
	[keys.widgetFilterCaption]: en[keys.widgetFilterCaption],
	[keys.widgetCaptionWithFilter]: en[keys.widgetCaptionWithFilter],
}

/**
 * Every key stands in for itself, except the caption templates, which come from the real
 * bundle so the assertion sees the same one-pass `{{vars}}` fill Payload's own `t` makes.
 */
export const captionT = (key: string, vars?: Record<string, string | number>): string =>
	(CAPTION_TEMPLATES[key] ?? key).replace(/\{\{(.*?)\}\}/g, (match, name: string) => {
		const value = vars?.[name.trim()]
		return value === undefined ? match : String(value)
	})

/**
 * A request over a runtime serving `adapters`, each engine read going straight to the adapter
 * and comparison on; `over` replaces any runtime field. Every key translates to itself.
 */
export const requestWith = (
	adapters: AnalyticsAdapter[],
	over: Partial<AnalyticsRuntime> = {}
): PayloadRequest => {
	const payload = { logger: { warn: () => {} } } as unknown as Payload
	setRuntime(payload, {
		registry: createRegistry(adapters),
		configAdapterIds: new Set(adapters.map((adapter) => adapter.id)),
		bindings: {},
		readAccess: () => true,
		engine: { read: async (adapter, query) => adapter.query(query, {}) },
		ttl: { aggregate: 3600, realtime: 300 },
		comparison: true,
		...over,
	})
	return { payload, i18n: { t: (key: string) => key, language: 'en' } } as unknown as PayloadRequest
}
