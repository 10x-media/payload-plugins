export interface Geo {
	country?: string
	region?: string
	city?: string
}

export interface GeoResolverOptions {
	trustedProxyHops?: number
}

/**
 * `opts` carries the install's `trustedProxyHops` for a resolver that reads the client address
 * from the forwarded chain. A resolver that only reads platform headers can ignore it.
 */
export type GeoResolver = (headers: Headers, opts?: GeoResolverOptions) => Geo | Promise<Geo>

export const platformHeaderResolver: GeoResolver = (headers) => ({
	country: headers.get('x-vercel-ip-country') ?? headers.get('cf-ipcountry') ?? undefined,
	region: headers.get('x-vercel-ip-country-region') ?? undefined,
	city: headers.get('x-vercel-ip-city') ?? undefined,
})

export const noopResolver: GeoResolver = () => ({})
