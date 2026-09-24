import type { PayloadHandler } from 'payload'
import { FLAGS_PATH } from '../options'

export const FLAGS_ENDPOINT_PATH = `${FLAGS_PATH}/:code`

let loading: Promise<Map<string, string>> | undefined

/**
 * Every flag the package ships, imported once per process and held as plain SVG strings.
 * Deferred rather than imported at module scope: the entry point is a barrel over roughly
 * 266 one-line modules, and at module scope that graph would be pulled into every route
 * that loads the Payload config, for a route most requests never touch. A rejected import
 * is evicted from the cache so a later request retries instead of inheriting the failure.
 */
const flagsByCode = (): Promise<Map<string, string>> => {
	loading ??= import('country-flag-icons/string/3x2')
		.then((module) => new Map<string, string>(Object.entries(module)))
		.catch((err: unknown) => {
			loading = undefined
			throw err
		})
	return loading
}

const CODE = /^[A-Za-z]{2}$/

const SVG_HEADERS: Record<string, string> = {
	'Content-Type': 'image/svg+xml; charset=utf-8',
	// The URL is the version: a flag only changes in a new package release, so the
	// answer never needs revalidating.
	'Cache-Control': 'public, max-age=31536000, immutable',
	'X-Content-Type-Options': 'nosniff',
	// Opened directly rather than through an <img>, an SVG is a document that can run
	// script. This one is denied everything but the inline style the artwork needs.
	'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'",
}

/**
 * Public GET serving one country flag as SVG, from `country-flag-icons`, so the admin
 * bundle carries no flag artwork and no client-side flag dependency.
 *
 * Unauthenticated on purpose: a flag is public, static artwork, identical for every
 * caller, and the handler reads only the in-process map above, touching no database, no
 * user, and no request scope. This diverges from this package's `ICON_MANIFEST_PATH`,
 * which is auth-gated because it exposes per-tenant configuration; the difference here
 * is deliberate, not an oversight.
 */
export const makeFlagsHandler = (): PayloadHandler => async (req) => {
	const raw = req.routeParams?.code
	const param = typeof raw === 'string' ? raw : ''
	const code = param.endsWith('.svg') ? param.slice(0, -'.svg'.length) : param
	// Checked before the artwork is loaded, so a malformed code costs nothing at all.
	if (!CODE.test(code)) {
		return new Response('Bad Request', { status: 400 })
	}
	const svg = (await flagsByCode()).get(code.toUpperCase())
	if (svg === undefined) {
		return new Response('Not Found', { status: 404 })
	}
	return new Response(svg, { headers: SVG_HEADERS, status: 200 })
}
