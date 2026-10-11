import { compile, match, parse } from 'path-to-regexp'
import {
	assertRouteBaseUnshadowed,
	isPluginEndpoint,
	type RootEndpointShape,
	type RouteBase,
} from './routes'

/** A path the pattern matches, each of its parameters filled with a sample segment. */
export const samplePath = (pattern: string): string => {
	const params: Record<string, string | string[]> = {}
	for (const token of parse(pattern)) {
		if (typeof token !== 'string') {
			params[String(token.name)] =
				token.modifier === '*' || token.modifier === '+' ? ['sample'] : 'sample'
		}
	}
	return compile(pattern, { validate: false })(params)
}

/** A root endpoint registered before the plugin's own `ours` that would answer its requests. */
interface ShadowedRoute {
	earlier: RootEndpointShape
	ours: RootEndpointShape
}

/**
 * The first plugin endpoint an earlier one takes: Payload's `handleEndpoints` answers with the first
 * endpoint whose method equals the request's and whose path path-to-regexp matches.
 */
export const shadowedRoute = (
	endpoints: readonly RootEndpointShape[]
): ShadowedRoute | undefined => {
	for (const [index, ours] of endpoints.entries()) {
		if (!isPluginEndpoint(ours)) {
			continue
		}
		const sample = samplePath(ours.path)
		for (const earlier of endpoints.slice(0, index)) {
			if (
				!isPluginEndpoint(earlier) &&
				earlier.method === ours.method &&
				match(earlier.path, { decode: decodeURIComponent })(sample) !== false
			) {
				return { earlier, ours }
			}
		}
	}
	return undefined
}

/** The slice of an assembled Payload config the route checks read. */
interface RoutedConfig {
	collections: ReadonlyArray<{ slug: string }>
	endpoints?: readonly RootEndpointShape[] | false | undefined
}

/**
 * Refuses an install where Payload would hand the plugin's requests to a collection named like the
 * base's first segment, or to a root endpoint registered before the plugin's own that matches one.
 */
export const assertRoutesReachable = (base: RouteBase, config: RoutedConfig): void => {
	assertRouteBaseUnshadowed(
		base,
		config.collections.map((collection) => collection.slug)
	)
	const shadowed = shadowedRoute(config.endpoints || [])
	if (shadowed) {
		const { earlier, ours } = shadowed
		throw new Error(
			`analytics: the root endpoint "${earlier.method.toUpperCase()} ${earlier.path}" is registered before the plugin's "${ours.path}" and matches it, so Payload would hand it every request meant for the plugin. Set routes.base to a path that endpoint does not match, or give that endpoint a path of its own.`
		)
	}
}
