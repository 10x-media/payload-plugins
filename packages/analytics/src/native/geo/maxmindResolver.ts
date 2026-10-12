import type { MaxmindReader, MaxmindSdk } from '../../core/sdks'
import { valueAt } from '../../core/values'
import { loadMaxmind } from '../../plugin/peers'
import { clientIpFromHeaders } from '../ingest/clientIp'
import {
	type Geo,
	type GeoResolver,
	type GeoResolverOptions,
	geoOf,
	loadsMaxmindAtRuntime,
} from './geoResolver'

export interface MaxmindOptions {
	dbPath: string
	/**
	 * `{ open }` from `maxmind`. Unset, the plugin's `sdks.maxmind` serves, and without either it is
	 * loaded at runtime, which a standalone build does not ship.
	 */
	sdk?: MaxmindSdk
}

/**
 * MaxMind GeoLite2 resolver, opened on first use. Any failure degrades to empty geo after one
 * warning, so a missing or unconfigured database never breaks ingestion.
 */
export function maxmindResolver(options: MaxmindOptions): GeoResolver {
	let readerPromise: Promise<MaxmindReader> | undefined
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

	const getReader = (pluginSdk: MaxmindSdk | undefined): Promise<MaxmindReader> => {
		if (!readerPromise) {
			readerPromise = (async () => {
				const { open } = options.sdk ?? pluginSdk ?? (await loadMaxmind())
				return open(options.dbPath)
			})()
		}
		return readerPromise
	}

	const resolve = async (headers: Headers, opts?: GeoResolverOptions): Promise<Geo> => {
		const ip = clientIpFromHeaders(headers, {
			trustedProxyHops: opts?.trustedProxyHops,
			trustedPlatform: opts?.trustedPlatform,
		})
		if (!ip) {
			return {}
		}
		let reader: MaxmindReader
		try {
			reader = await getReader(opts?.maxmind)
		} catch (err) {
			warn(err)
			return {}
		}
		try {
			const found = reader.get(ip)
			return geoOf({
				country: valueAt(found, 'country.iso_code'),
				region: valueAt(found, 'subdivisions.0.iso_code'),
				city: valueAt(found, 'city.names.en'),
			})
		} catch (err) {
			warn(err)
			return {}
		}
	}
	return options.sdk ? resolve : loadsMaxmindAtRuntime(resolve)
}
