import type { Config, SanitizedConfig } from 'payload'

import type { HiddenPredicates } from '../types'
import { REGISTRY_KEY } from './constants'
import type { ResolvedOverlay } from './resolveOptions'

/**
 * What the plugin parks under `config.custom`: the resolved overlays, plus the
 * function-valued `admin.hidden` predicates it overwrote at boot so the manifest can
 * still honour them.
 *
 * `custom` is listed in Payload's `serverOnlyConfigProperties`, so none of this,
 * including every access function and component path, reaches the browser.
 */
export type SettingsOverlayRegistry = {
	hiddenPredicates: HiddenPredicates
	lazyTransport: 'server-function' | 'widget'
	overlays: ResolvedOverlay[]
}

export const setRegistry = (config: Config, registry: SettingsOverlayRegistry): void => {
	config.custom ??= {}
	config.custom[REGISTRY_KEY] = registry
}

/** The registry at runtime, or `undefined` when the plugin did not run. */
export const getRegistry = (
	config: Pick<Config | SanitizedConfig, 'custom'>
): SettingsOverlayRegistry | undefined =>
	(config.custom as Record<string, SettingsOverlayRegistry | undefined> | undefined)?.[REGISTRY_KEY]

/** One overlay by id, or `undefined` when the reader named one that does not exist. */
export const getOverlay = (
	config: Pick<Config | SanitizedConfig, 'custom'>,
	overlayId: string
): ResolvedOverlay | undefined =>
	getRegistry(config)?.overlays.find((overlay) => overlay.id === overlayId)
