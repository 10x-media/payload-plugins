import type { PayloadRequest, WidgetInstance } from 'payload'
import { type CapabilityRequirement, satisfiesCapabilities } from '../core/capabilities'
import type { AnalyticsCapabilities } from '../core/contract'
import { isMetricKey } from '../core/guards'
import { servedName } from '../core/metricAliases'
import { resolveReadContext } from '../core/scopedRead'
import { isRecord } from '../core/values'
import { isBuiltInWidgetSlug } from '../core/widgetSlugs'
import { getRuntime } from '../plugin/runtime'
import { analyticsDefaultWidgets } from './defaults'
import { builtInWidgetRequires } from './registerWidgets'

/** @beta */
export interface AnalyticsDefaultLayoutOptions {
	/**
	 * The layout to narrow. Default `analyticsDefaultWidgets()`. A widget that is not the plugin's,
	 * or one naming its own `dataSource`, is kept as placed.
	 */
	widgets?: WidgetInstance[]
}

/** Typed as `unknown` so an app's generated widget data unions read alike. */
const dataField = (data: unknown, key: string): unknown => (isRecord(data) ? data[key] : undefined)

/** What one placed built-in widget reads: its widget's own needs plus the metric it opens on. */
const requirementOf = (
	instance: WidgetInstance,
	caps: AnalyticsCapabilities
): CapabilityRequirement | undefined => {
	if (!isBuiltInWidgetSlug(instance.widgetSlug)) {
		return undefined
	}
	const requires = builtInWidgetRequires(instance.widgetSlug) ?? {}
	const metric = dataField(instance.data, 'metric')
	const metrics = [...(requires.metrics ?? []), ...(isMetricKey(metric) ? [metric] : [])]
	// A metric served under another name (`visits` as `sessions`) is read, so asked, under that one.
	return { ...requires, metrics: metrics.map((m) => servedName(m, caps.metrics)) }
}

const namesSource = (instance: WidgetInstance): boolean =>
	typeof dataField(instance.data, 'dataSource') === 'string'

/**
 * `admin.dashboard.defaultLayout` for a reader: the default widgets less those the reader's default
 * source cannot answer (realtime, goals, a breakdown's dimension, a metric it lacks). With no
 * runtime or no source the reader may read, the whole list.
 *
 * @beta
 */
export const analyticsDefaultLayout =
	(options: AnalyticsDefaultLayoutOptions = {}) =>
	async ({ req }: { req: PayloadRequest }): Promise<WidgetInstance[]> => {
		const widgets = options.widgets ?? analyticsDefaultWidgets()
		const runtime = getRuntime(req.payload)
		if (!runtime) {
			return widgets
		}
		const read = await resolveReadContext({ runtime, req })
		if (!read.ok) {
			return widgets
		}
		const caps = read.adapter.capabilities
		return widgets.filter((instance) => {
			if (namesSource(instance)) {
				return true
			}
			const requirement = requirementOf(instance, caps)
			return requirement === undefined || satisfiesCapabilities(caps, requirement)
		})
	}
