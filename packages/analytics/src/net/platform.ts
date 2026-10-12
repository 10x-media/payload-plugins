/**
 * A hosting platform whose edge writes the visitor's address and location into request headers,
 * replacing whatever the visitor sent under those names. Only then is reading them safe.
 */
export type TrustedPlatform = 'vercel' | 'cloudflare'

export const isTrustedPlatform = (value: unknown): value is TrustedPlatform =>
	value === 'vercel' || value === 'cloudflare'

/** Where one platform puts the visitor's address and location. */
interface PlatformHeaders {
	ip: string
	country: string
	region: string
	city: string
}

/**
 * Cloudflare sends `cf-region-code` and `cf-ipcity` only once its visitor location headers are
 * turned on.
 */
export const PLATFORM_HEADERS: Readonly<Record<TrustedPlatform, PlatformHeaders>> = {
	vercel: {
		ip: 'x-real-ip',
		country: 'x-vercel-ip-country',
		region: 'x-vercel-ip-country-region',
		city: 'x-vercel-ip-city',
	},
	cloudflare: {
		ip: 'cf-connecting-ip',
		country: 'cf-ipcountry',
		region: 'cf-region-code',
		city: 'cf-ipcity',
	},
}

/**
 * Every header an edge writes about the visitor. None is relayed raw: an upstream learns only the
 * address the install's own trust settings resolved.
 */
export const VISITOR_HEADERS: readonly string[] = [
	...Object.values(PLATFORM_HEADERS).flatMap((headers) => Object.values(headers)),
	'x-vercel-forwarded-for',
	'cf-connecting-ipv6',
	'cf-region',
	'true-client-ip',
]
