import { type ApiPathConfigSource, apiPath } from '../plugin/apiPath'
import { analyticsRoutes, type RoutesConfigSource } from '../plugin/routes'

/** The slice of a Payload config, server or client, the flag route's URL is built from. */
export interface FlagsConfigSource extends RoutesConfigSource, ApiPathConfigSource {}

/** Where the flag route answers on this install, relative and behind the Next basePath. */
export const countryFlagsMount = (config: FlagsConfigSource): string =>
	apiPath(config, analyticsRoutes(config).flags)

/**
 * The flag route's URL for one ISO 3166-1 alpha-2 code under `mount`. The `.svg` suffix is there
 * for a reader who opens the URL directly.
 */
export const countryFlagSrc = (mount: string, code: string): string =>
	`${mount}/${encodeURIComponent(code.toLowerCase())}.svg`
