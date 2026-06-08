import type { CityResponse, Reader } from 'maxmind'
import type { Geo, GeoResolver } from './geoResolver'

export interface MaxmindOptions {
	dbPath: string
}

const clientIp = (headers: Headers): string | null => {
	const fwd = headers.get('x-forwarded-for')?.split(',')[0]?.trim()
	return fwd || headers.get('x-real-ip') || null
}

/**
 * Optional MaxMind GeoLite2 resolver. The mmdb and the maxmind lib are loaded
 * lazily on first use. Any failure (lib not installed, file missing/unreadable,
 * lookup error) degrades to empty geo after a single warning, so a missing or
 * unconfigured database never breaks ingestion.
 */
export function maxmindResolver(options: MaxmindOptions): GeoResolver {
	let readerPromise: Promise<Reader<CityResponse>> | undefined
	let warned = false

	const warn = (detail: unknown): null => {
		if (!warned) {
			warned = true
			console.warn(
				`[analytics] MaxMind geo unavailable for "${options.dbPath}"; geo will be empty.`,
				detail instanceof Error ? detail.message : detail
			)
		}
		return null
	}

	const getReader = (): Promise<Reader<CityResponse>> => {
		if (!readerPromise) {
			readerPromise = (async () => {
				const { open } = await import('maxmind')
				return open<CityResponse>(options.dbPath)
			})()
		}
		return readerPromise
	}

	return async (headers: Headers): Promise<Geo> => {
		const ip = clientIp(headers)
		if (!ip) {
			return {}
		}
		let reader: Reader<CityResponse> | null
		try {
			reader = await getReader()
		} catch (err) {
			warn(err)
			return {}
		}
		try {
			const r = reader.get(ip)
			if (!r) {
				return {}
			}
			return {
				country: r.country?.iso_code ?? undefined,
				region: r.subdivisions?.[0]?.iso_code ?? undefined,
				city: r.city?.names.en ?? undefined,
			}
		} catch (err) {
			warn(err)
			return {}
		}
	}
}
