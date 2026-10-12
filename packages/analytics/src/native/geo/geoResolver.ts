import type { MaxmindSdk } from '../../core/sdks'
import { PLATFORM_HEADERS, type TrustedPlatform } from '../../net/platform'

export interface Geo {
	country?: string
	region?: string
	city?: string
}

const GEO_FIELDS = ['country', 'region', 'city'] as const satisfies ReadonlyArray<keyof Geo>

/** The location fields of `values` that are non-empty text, any other value left out. */
export const geoOf = (values: Readonly<Partial<Record<keyof Geo, unknown>>>): Geo => {
	const geo: Geo = {}
	for (const field of GEO_FIELDS) {
		const value = values[field]
		if (typeof value === 'string' && value !== '') {
			geo[field] = value
		}
	}
	return geo
}

/** The install's request trust, handed to every resolver in a chain. */
export interface GeoResolverOptions {
	trustedProxyHops?: number
	/**
	 * The platform whose location headers may be read. Unset, no platform header is trusted: a
	 * visitor can send `cf-ipcountry` or `x-vercel-ip-country` themselves.
	 */
	trustedPlatform?: TrustedPlatform
	/**
	 * The plugin's `sdks.maxmind`, for a resolver that opens a MaxMind database and was handed no
	 * reader of its own.
	 */
	maxmind?: MaxmindSdk
}

/**
 * `opts` carries the install's request trust. A resolver reading platform headers must read them
 * only for `trustedPlatform`.
 */
export type GeoResolver = (headers: Headers, opts?: GeoResolverOptions) => Geo | Promise<Geo>

/**
 * The location the install's `trustedPlatform` wrote into the request, and nothing at all
 * without one, whichever platform headers the request carries.
 */
export const platformHeaderResolver: GeoResolver = (headers, opts) => {
	const platform = opts?.trustedPlatform
	if (platform === undefined) {
		return {}
	}
	const names = PLATFORM_HEADERS[platform]
	return {
		country: headers.get(names.country) ?? undefined,
		region: headers.get(names.region) ?? undefined,
		city: headers.get(names.city) ?? undefined,
	}
}

export const noopResolver: GeoResolver = () => ({})

/** `Symbol.for`, so the `/geo` entry and the native adapter agree on it from separate bundles. */
const LOADS_MAXMIND = Symbol.for('@10x-media/analytics/geo-loads-maxmind')

/**
 * Marks a resolver that loads `maxmind` at runtime unless the plugin hands it `sdks.maxmind`, so
 * the native engine can warn at boot rather than at the first lookup.
 */
export const loadsMaxmindAtRuntime = (resolver: GeoResolver): GeoResolver => {
	Reflect.set(resolver, LOADS_MAXMIND, true)
	return resolver
}

/** Whether a resolver, or one it composes, loads `maxmind` at runtime without `sdks.maxmind`. */
export const needsMaxmindSdk = (resolver: GeoResolver): boolean =>
	Reflect.get(resolver, LOADS_MAXMIND) === true
