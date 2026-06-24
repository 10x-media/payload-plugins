import type { Geo, GeoResolver } from './geoResolver'

export function composeGeoResolvers(...resolvers: GeoResolver[]): GeoResolver {
	return async (headers: Headers): Promise<Geo> => {
		for (const resolve of resolvers) {
			const geo = await resolve(headers)
			if (geo.country) {
				return geo
			}
		}
		return {}
	}
}
