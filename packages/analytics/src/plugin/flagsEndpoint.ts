import type { PayloadHandler } from 'payload'
import { analyticsError, errorResponse } from './errors'

let loading: Promise<Map<string, string>> | undefined

/**
 * Flags as SVG strings, loaded lazily: the entry is a barrel of some 300 modules that every route
 * importing the config would pull in. A failed import is not cached, so later requests retry.
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
	// A flag is keyed by its country code and only ever changes in a new release of the
	// package, so the URL itself is the version and the answer never needs revalidating.
	'Cache-Control': 'public, max-age=31536000, immutable',
	'X-Content-Type-Options': 'nosniff',
	// Opened directly rather than through an <img>, an SVG is a document that can run
	// script. This one is denied everything but the inline fills the artwork needs.
	'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'",
}

/**
 * Public GET serving one country flag SVG, so the admin bundle ships no flag artwork.
 * Unauthenticated on purpose: it reads only a static map, never data, user or scope.
 */
export const makeFlagsHandler = (): PayloadHandler => async (req) => {
	const raw = req.routeParams?.code
	const param = typeof raw === 'string' ? raw : ''
	const code = param.endsWith('.svg') ? param.slice(0, -'.svg'.length) : param
	// Checked before the artwork is loaded, so a malformed code costs nothing at all.
	if (!CODE.test(code)) {
		return errorResponse(
			400,
			analyticsError('invalid_param', 'analytics: flag code must be two letters', 'code')
		)
	}
	const svg = (await flagsByCode()).get(code.toUpperCase())
	if (svg === undefined) {
		return errorResponse(
			404,
			analyticsError('not_found', `analytics: no flag for "${code.toUpperCase()}"`)
		)
	}
	return new Response(svg, { headers: SVG_HEADERS, status: 200 })
}
