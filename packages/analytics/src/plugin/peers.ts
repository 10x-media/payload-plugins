import { type Ga4Sdk, isGa4Sdk, isMaxmindSdk, type MaxmindSdk } from '../core/sdks'
import { hasMethods } from '../core/values'
import { collectingPageData } from './buildPhase'
import { isModuleNotFoundError } from './peerImportError'

/**
 * Imports an optional peer missing from `sdks` by a runtime-joined specifier, since a literal one
 * fails a build without it. That also hides it from file tracing, hence `sdks`.
 */
export const importPeer = (parts: readonly string[]): Promise<unknown> => {
	const specifier = parts.join('/')
	return import(/* webpackIgnore: true */ /* turbopackIgnore: true */ /* @vite-ignore */ specifier)
}

/** Imports a peer, turning "not installed" into an error that says what to do about it. */
const loadPeer = async (parts: readonly string[], whenMissing: string): Promise<unknown> => {
	try {
		return await importPeer(parts)
	} catch (err) {
		if (isModuleNotFoundError(err)) {
			throw new Error(whenMissing, { cause: err })
		}
		throw err
	}
}

/** A module namespace, or a function carrying members of its own. */
const isContainer = (value: unknown): value is object =>
	(typeof value === 'object' && value !== null) || typeof value === 'function'

/**
 * The module namespace when it carries `names`, else its default export: Node names a CommonJS
 * module's exports itself, but a bundler may only hand over `default`.
 */
const namespaceWith = (mod: unknown, names: readonly string[]): unknown =>
	hasMethods(mod, names) || !isContainer(mod) ? mod : Reflect.get(mod, 'default')

/** Why a package loaded at runtime is a problem, said once for every message that names it. */
const TRACING =
	'standalone and serverless builds only ship the packages the app imports itself, so a package the plugin loads at runtime is missing there'

/** A message about one peer package, in the form every peer failure is reported in. */
export const peerError = (pkg: string, problem: string): string =>
	`analytics: peer "${pkg}" ${problem}`

/** The production boot warning for a GA4 source that would load its SDK at runtime. */
export const GA4_SDK_WARNING = peerError(
	'@google-analytics/data',
	`will load at runtime for a GA4 source because sdks.ga4 is not set, and ${TRACING}. Import it and pass it in: import { BetaAnalyticsDataClient } from '@google-analytics/data', then sdks: { ga4: { BetaAnalyticsDataClient } }.`
)

/** The production boot warning for MaxMind geo that would load its reader at runtime. */
export const MAXMIND_SDK_WARNING = peerError(
	'maxmind',
	`will load at runtime for MaxMind geo because sdks.maxmind is not set, and ${TRACING}. Import it and pass it in: import { open } from 'maxmind', then sdks: { maxmind: { open } }.`
)

/**
 * Whether this process serves a production build, where a package loaded at runtime may be missing.
 * `next build` collecting page data serves nothing, so it is not one.
 */
export const isProductionBuild = (): boolean =>
	// biome-ignore lint/plugin/noProcessEnv: the SDK warnings are for production builds only, gated the way Payload gates its own
	process.env.NODE_ENV === 'production' && !collectingPageData()

const GA4_PACKAGE: readonly string[] = ['@google-analytics', 'data']

const MAXMIND_PACKAGE: readonly string[] = ['maxmind']

/** The GA4 Data API client, for a source handed no `sdk`; only a test changes `parts`. */
export const loadGa4 = async (parts: readonly string[] = GA4_PACKAGE): Promise<Ga4Sdk> => {
	const mod = namespaceWith(
		await loadPeer(
			parts,
			peerError(
				'@google-analytics/data',
				`could not be loaded, and a GA4 source needs it. Install it (pnpm add @google-analytics/data) and pass it in as sdks: { ga4: { BetaAnalyticsDataClient } }, since ${TRACING}.`
			)
		),
		['BetaAnalyticsDataClient']
	)
	if (!isGa4Sdk(mod)) {
		throw new Error(
			peerError(
				'@google-analytics/data',
				'has no BetaAnalyticsDataClient. Update it: pnpm add @google-analytics/data@latest'
			)
		)
	}
	return mod
}

/** The MaxMind database reader, for geo handed no `sdk`; only a test changes `parts`. */
export const loadMaxmind = async (
	parts: readonly string[] = MAXMIND_PACKAGE
): Promise<MaxmindSdk> => {
	const mod = namespaceWith(
		await loadPeer(
			parts,
			peerError(
				'maxmind',
				`could not be loaded, and MaxMind geo needs it. Install it (pnpm add maxmind) and pass it in as sdks: { maxmind: { open } }, since ${TRACING}.`
			)
		),
		['open']
	)
	if (!isMaxmindSdk(mod)) {
		throw new Error(peerError('maxmind', 'has no open(). Update it: pnpm add maxmind@latest'))
	}
	return mod
}
