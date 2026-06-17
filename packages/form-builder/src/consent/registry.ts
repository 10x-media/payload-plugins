import type { AnyConsentSource } from './defineConsentSource'

export type ConsentSourceRegistry = Map<string, AnyConsentSource>

/** `false` removes a built-in, `true` keeps it, a definition adds or replaces one. */
export type ConsentSourceOption = boolean | AnyConsentSource

export type ConsentSourcesConfig = Record<string, ConsentSourceOption>

/**
 * Resolve the active consent-source registry from built-in defaults and a consumer override map.
 * `false` removes a type, `true` keeps the default (no-op when none exists), a definition adds or
 * replaces. Mirrors the action and field-type registry convention.
 */
export const resolveConsentSources = (
	defaults: Record<string, AnyConsentSource>,
	config: ConsentSourcesConfig = {}
): ConsentSourceRegistry => {
	const registry: ConsentSourceRegistry = new Map(Object.entries(defaults))
	for (const [type, option] of Object.entries(config)) {
		if (option === false) {
			registry.delete(type)
		} else if (option === true) {
			// keep the default; no-op when no default exists for this key
		} else {
			registry.set(type, option)
		}
	}
	return registry
}
