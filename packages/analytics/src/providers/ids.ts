import { keys, type TranslationKey } from '../translations/keys'

export type ProviderId = 'native' | 'plausible' | 'umami' | 'ga4' | 'posthog'
export const PROVIDER_IDS = [
	'native',
	'plausible',
	'umami',
	'ga4',
	'posthog',
] as const satisfies readonly ProviderId[]

/** Each provider type's name, as the Provider select and the Connection panel show it. */
export const PROVIDER_NAMES: Readonly<Record<ProviderId, TranslationKey>> = {
	native: keys.providerNameNative,
	plausible: keys.providerNamePlausible,
	umami: keys.providerNameUmami,
	ga4: keys.providerNameGa4,
	posthog: keys.providerNamePosthog,
}

/** The registry id of a provider document's adapter, which grants and stand-ins must match. */
export const documentAdapterId = (provider: unknown, id: unknown): string =>
	`${String(provider)}:${String(id)}`

/**
 * The provider document a registry id names, the inverse of {@link documentAdapterId}; undefined
 * for an id no document gives.
 */
export const documentIdOf = (adapterId: string): string | undefined => {
	const at = adapterId.indexOf(':')
	const provider = adapterId.slice(0, at)
	return at > 0 && at < adapterId.length - 1 && PROVIDER_IDS.some((id) => id === provider)
		? adapterId.slice(at + 1)
		: undefined
}
