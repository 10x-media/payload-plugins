import type {
	SettingsOverlayConfig,
	SettingsOverlayItem,
	SettingsOverlayPluginOptions,
} from '../types'

/** An overlay with every optional switch decided, so nothing downstream re-derives defaults. */
export type ResolvedOverlay = {
	addressable: boolean
	hideEntities: boolean
	layout: NonNullable<SettingsOverlayConfig['layout']>
	mergeListHeader: boolean
	searchable: boolean
} & SettingsOverlayConfig

export type ResolvedOptions = {
	lazyTransport: NonNullable<SettingsOverlayPluginOptions['lazyTransport']>
	overlays: ResolvedOverlay[]
}

/**
 * Applies plugin-level `defaults` under each overlay's own settings. Component slots merge
 * per slot rather than wholesale, so an overlay overriding `RailItem` keeps the default
 * `Header` it never mentioned.
 */
export const resolveOptions = (options: SettingsOverlayPluginOptions): ResolvedOptions => {
	const defaults = options.defaults ?? {}

	return {
		lazyTransport: options.lazyTransport ?? 'widget',
		overlays: (options.overlays ?? []).map((overlay) => ({
			...overlay,
			addressable: overlay.addressable ?? defaults.addressable ?? true,
			components: { ...defaults.components, ...overlay.components },
			hideEntities: overlay.hideEntities ?? defaults.hideEntities ?? false,
			layout: overlay.layout ?? defaults.layout ?? 'compact',
			mergeListHeader: overlay.mergeListHeader ?? defaults.mergeListHeader ?? true,
			searchable: overlay.searchable ?? defaults.searchable ?? false,
		})),
	}
}

/** True when any overlay holds an item the panel cannot render ahead of time. */
export const hasLazyItems = (overlays: ResolvedOverlay[]): boolean =>
	overlays.some((overlay) => overlay.items.some(isLazyItem))

/**
 * Items that reach the panel through `render-widget` rather than through the provider's
 * eager render. A `view` always does: rendering a full admin view on every page load is
 * not a cost the plugin may impose. A `component` does only when it asks to.
 */
export const isLazyItem = (item: SettingsOverlayItem): boolean =>
	item.type === 'view' || (item.type === 'component' && item.lazy === true)
