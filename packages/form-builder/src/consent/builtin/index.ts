import type { AnyConsentSource } from '../defineConsentSource'
import { pageReferenceSource } from './pageReference'
import { buildStaticSource } from './static'

/**
 * Built-in consent sources with content-bearing config fields (the static source's link label)
 * carrying `localized: true` when `localize` is true. `pageReference` config holds only
 * identifiers and is shared static.
 */
export const buildDefaultConsentSources = (
	localize: boolean
): Record<string, AnyConsentSource> => ({
	static: buildStaticSource(localize) as AnyConsentSource,
	pageReference: pageReferenceSource as AnyConsentSource,
})

/**
 * Prebuilt with content localization on; with `localizeContent: false`, derive overrides from
 * `buildDefaultConsentSources(false)` instead so a spread does not reintroduce `localized`.
 */
export const defaultConsentSources: Record<string, AnyConsentSource> =
	buildDefaultConsentSources(true)
