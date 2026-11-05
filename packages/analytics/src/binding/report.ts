import type { AnalyticsBinding } from './types'

/** What a per-document surface reports on: the document's own page, or the document as an item. */
export type ReportMode = 'page' | 'item'

/** `auto` follows the binding; the other two pin one report. */
export type ReportOption = 'auto' | ReportMode

/** Whether the binding counts its documents as content items shown on other pages. */
export const bindsItems = (binding: AnalyticsBinding | undefined): boolean => binding?.item === true

/** Whether the binding maps its documents to a page of their own. */
const bindsPages = (binding: AnalyticsBinding | undefined): boolean =>
	binding !== undefined && (binding.path !== undefined || binding.pathField !== undefined)

/**
 * Reports a document surface offers, default first: `auto` offers what the binding binds, item
 * before page; a pinned report is offered alone so the surface says it is not set up.
 */
export const reportModes = (
	binding: AnalyticsBinding | undefined,
	option: ReportOption = 'auto'
): ReportMode[] => {
	if (option !== 'auto') {
		return [option]
	}
	const modes: ReportMode[] = []
	if (bindsItems(binding)) {
		modes.push('item')
	}
	if (bindsPages(binding)) {
		modes.push('page')
	}
	return modes.length > 0 ? modes : ['page']
}

/** A report a request named, if it is one; anything else is no choice at all. */
export const readReportMode = (value: unknown): ReportMode | undefined =>
	value === 'item' || value === 'page' ? value : undefined

/** The collections bound as items: the only ones whose refs ingest keeps. */
export const itemCollectionsOf = (
	bindings: Record<string, AnalyticsBinding>
): ReadonlySet<string> =>
	new Set(
		Object.entries(bindings)
			.filter(([, binding]) => bindsItems(binding))
			.map(([slug]) => slug)
	)
