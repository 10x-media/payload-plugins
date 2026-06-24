import type { Field, Widget, WidgetWidth } from 'payload'
import { type CapabilityRequirement, satisfiesCapabilities } from '../core/capabilities'
import type { AnalyticsAdapter } from '../core/contract'

/** App-provided custom dashboard widget. Registered via the `widgets.register` option. */
export interface CustomWidgetDef {
	slug: string
	/** The app's own RSC import path, e.g. `@/widgets/My#default`. */
	component: string
	/** A plain label, a locale->label map, or a Payload label function (`Widget['label']`). */
	label: Exclude<Widget['label'], undefined>
	fields?: Field[]
	/** Capability gate; omit to always register. */
	requires?: CapabilityRequirement
	minWidth?: WidgetWidth
	maxWidth?: WidgetWidth
}

const isSupported = (
	requires: CapabilityRequirement | undefined,
	adapters: AnalyticsAdapter[]
): boolean => !requires || adapters.some((a) => satisfiesCapabilities(a.capabilities, requires))

/**
 * Turn app-provided custom widget defs into Payload widgets: validate the slug (the
 * `analytics-` prefix is reserved for built-ins), skip a disabled slug, and drop a def
 * whose `requires` no configured adapter satisfies. Throws on a reserved or empty slug
 * so a misconfiguration fails at boot rather than silently dropping the widget.
 */
export const buildCustomWidgets = (
	defs: CustomWidgetDef[],
	adapters: AnalyticsAdapter[],
	disabled: string[]
): Widget[] => {
	const built: Widget[] = []
	for (const def of defs) {
		if (!def.slug || def.slug.startsWith('analytics-')) {
			throw new Error(
				`analytics: custom widget slug "${def.slug}" is invalid; it must be non-empty and must not use the reserved "analytics-" prefix`
			)
		}
		if (disabled.includes(def.slug)) {
			continue
		}
		if (!isSupported(def.requires, adapters)) {
			continue
		}
		built.push({
			slug: def.slug,
			Component: def.component,
			label: def.label,
			fields: def.fields ?? [],
			minWidth: def.minWidth,
			maxWidth: def.maxWidth,
		})
	}
	return built
}
