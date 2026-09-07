import { type Config, definePlugin } from 'payload'

import { hideEntities } from './plugin/hideEntities'
import { registerComponents } from './plugin/registerComponents'
import { registerTranslations } from './plugin/registerTranslations'
import { setRegistry } from './plugin/registry'
import { resolveOptions } from './plugin/resolveOptions'
import { validateOverlays } from './plugin/validate'
import type { SettingsOverlayPluginOptions } from './types'

declare module 'payload' {
	interface RegisteredPlugins {
		'@10x-media/settings-overlay': SettingsOverlayPluginOptions
	}
}

/**
 * Files collections, globals, registered admin views, components and links behind floating
 * panels, and makes each panel addressable by URL.
 *
 * Composable on purpose: only the entities you list are touched. A listed collection or
 * global is hidden from the nav and its own route, so there is one way in rather than two,
 * and gets an invisible form-modified reporter so the panel can confirm before discarding
 * edits. Access functions, component paths and `resolveDocID` stay on the server: the full
 * config is parked under `config.custom`, which Payload never sends to the browser, and the
 * rail each reader sees is computed server-side.
 */
export const settingsOverlay = definePlugin<SettingsOverlayPluginOptions>({
	slug: '@10x-media/settings-overlay',
	plugin: ({ config, plugins: _plugins, ...options }): Config => {
		if (options.disabled === true) {
			return config
		}

		const { lazyTransport, overlays } = resolveOptions(options)

		validateOverlays(overlays, {
			collectionSlugs: (config.collections ?? []).map((collection) => collection.slug),
			globalSlugs: (config.globals ?? []).map((global) => global.slug),
			viewKeys: Object.keys(config.admin?.components?.views ?? {}),
		})

		const { collections, globals, hiddenPredicates } = hideEntities(config, overlays)

		const next: Config = {
			...config,
			admin: registerComponents(config, overlays, lazyTransport),
			collections,
			custom: { ...config.custom },
			globals,
		}

		setRegistry(next, { hiddenPredicates, lazyTransport, overlays })
		registerTranslations(next, options.translations)

		return next
	},
})

export { QUERY_PARAM, SEARCH_PARAM } from './plugin/constants'
export { getOverlay, getRegistry, type SettingsOverlayRegistry } from './plugin/registry'
export * from './types'
export type { SettingsOverlayPluginOptions as PluginOptions }
