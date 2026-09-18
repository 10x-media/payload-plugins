import type { Geo, GeoResolver, GeoResolverOptions } from './geoResolver'

export function composeGeoResolvers(...resolvers: GeoResolver[]): GeoResolver {
	return async (headers: Headers, opts?: GeoResolverOptions): Promise<Geo> => {
		for (const resolve of resolvers) {
			const geo = await resolve(headers, opts)
			if (geo.country) {
				return geo
			}
		}
		return {}
	}
}
