import {
	type Geo,
	type GeoResolver,
	type GeoResolverOptions,
	loadsMaxmindAtRuntime,
	needsMaxmindSdk,
} from './geoResolver'

/** Asks each resolver in turn and answers the first location with a country, else an empty one. */
export function composeGeoResolvers(...resolvers: GeoResolver[]): GeoResolver {
	const composed = async (headers: Headers, opts?: GeoResolverOptions): Promise<Geo> => {
		for (const resolve of resolvers) {
			const geo = await resolve(headers, opts)
			if (geo.country) {
				return geo
			}
		}
		return {}
	}
	return resolvers.some(needsMaxmindSdk) ? loadsMaxmindAtRuntime(composed) : composed
}
