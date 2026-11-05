import { monotonicMs } from '../../core/monotonic'
import { isRecord } from '../../core/values'
import { type Geo, type GeoResolver, type GeoResolverOptions, geoOf } from './geoResolver'

/** How often one resolver that keeps failing is reported, at most. */
const GEO_WARN_EVERY_MS = 60 * 60_000

const warnedAt = new WeakMap<GeoResolver, number>()

/**
 * A failing or malformed resolver costs the event its location, never the event. Failures are
 * reported at most once an hour per resolver.
 */
export const resolveGeo = async (
	resolver: GeoResolver,
	headers: Headers,
	options: { trust: GeoResolverOptions; warn?: (message: string) => void }
): Promise<Geo> => {
	const { trust, warn } = options
	let answer: unknown
	try {
		answer = await resolver(headers, trust)
	} catch (err) {
		const at = monotonicMs()
		const last = warnedAt.get(resolver)
		if (last === undefined || at - last >= GEO_WARN_EVERY_MS) {
			warnedAt.set(resolver, at)
			warn?.(
				`analytics: the geo resolver threw, so events are stored without a location while it fails: ${String(err)}`
			)
		}
		return {}
	}
	return isRecord(answer) ? geoOf(answer) : {}
}
