import type { PayloadRequest } from 'payload'
import type { AnalyticsAdapter } from './contract'
import { keysOf, optionsObject } from './optionChecks'
import { isRecord, kindOf, listOf } from './values'

/** A source one scope reads through, as `defaultSource` is shown it. */
export interface SourceRef {
	id: string
	label: string
	/** `config` for an adapter every scope shares, `runtime` for one resolved per scope. */
	kind: 'config' | 'runtime'
	/** The provider document granting it to the scope; absent for a shared adapter none grants. */
	docId?: string
}

/** A source the reader reads a scope through by one of that scope's own provider documents. */
export interface OwnSource {
	id: string
	label: string
	docId: string
}

/**
 * Decides whether a member of `scope` reads it through the shared adapter `adapterId`. Asked at
 * most once per request, scope and adapter; a throw counts as no.
 */
export type SourcePolicyFunction = (args: {
	req: PayloadRequest
	scope: string
	adapterId: string
	/** Sources the reader already reads the scope through by its own provider documents. */
	ownSources: OwnSource[]
}) => boolean | Promise<boolean>

/**
 * Who besides `access.crossScope.unscopedSource` reads a tenant through a shared adapter: `staff`
 * nobody else, `tenant` the scope's members, `fallback` its members until they have a source of their own.
 */
export type SourcePolicy = 'staff' | 'tenant' | 'fallback' | SourcePolicyFunction

/** How tenants reach one shared config adapter. */
export interface AnalyticsSourceOptions {
	/**
	 * Which of a tenant's own users read it, narrowed to their tenant. Default `staff`. Anything else
	 * needs an adapter that narrows a query to one scope (`capabilities.scopedQueries`).
	 */
	tenants?: SourcePolicy
}

/** Picks a tenant scope's default source by id; an id it cannot read leaves the default alone. */
export type DefaultSourceFunction = (args: {
	req: PayloadRequest
	scope: string
	sources: SourceRef[]
}) => string | undefined | Promise<string | undefined>

/**
 * A tenant scope's default source when no provider document of it is flagged the default:
 * `tenantFirst` its own first, `platformFirst` the `platformAdapter`, or a function.
 */
export type DefaultSourceRule = 'tenantFirst' | 'platformFirst' | DefaultSourceFunction

/** `sources` and `defaultSource`, checked against the adapters they name. */
export interface ResolvedSources {
	/** Each config adapter whose tenants read under a policy other than `staff`. */
	policies: ReadonlyMap<string, Exclude<SourcePolicy, 'staff'>>
	defaultSource?: DefaultSourceRule
}

const SOURCE_KEYS = keysOf<AnalyticsSourceOptions>({ tenants: true })
const POLICY_NAMES: readonly string[] = ['staff', 'tenant', 'fallback']
const DEFAULT_RULES: readonly string[] = ['tenantFirst', 'platformFirst']

const isPolicy = (value: unknown): value is SourcePolicy =>
	typeof value === 'function' || (typeof value === 'string' && POLICY_NAMES.includes(value))

const isDefaultRule = (value: unknown): value is DefaultSourceRule =>
	typeof value === 'function' || (typeof value === 'string' && DEFAULT_RULES.includes(value))

const resolvePolicy = (
	id: string,
	entry: unknown,
	adapter: AnalyticsAdapter
): Exclude<SourcePolicy, 'staff'> | undefined => {
	const { tenants } = optionsObject(entry, {
		path: `sources.${id}`,
		known: SOURCE_KEYS,
		example: "an object such as { tenants: 'fallback' }",
	})
	if (tenants === undefined) {
		return undefined
	}
	if (!isPolicy(tenants)) {
		throw new Error(
			`analytics: sources.${id}.tenants must be 'staff', 'tenant', 'fallback' or a function, got ${kindOf(tenants)}`
		)
	}
	if (tenants === 'staff') {
		return undefined
	}
	if (adapter.capabilities.scopedQueries !== true) {
		throw new Error(
			`analytics: sources.${id}.tenants lets a tenant's own users read through the "${id}" adapter, which cannot narrow a query to one scope (it lacks capabilities.scopedQueries), so a tenant would read every tenant's totals. Leave it 'staff', or give it to an adapter that supports scoped queries.`
		)
	}
	return tenants
}

/**
 * `sources` and `defaultSource`. A switched-off plugin given no adapters has nothing to check
 * the keys against, and reads through nothing anyway.
 */
export const resolveSources = (options: {
	adapters?: readonly AnalyticsAdapter[]
	platformAdapter?: string
	sources?: unknown
	defaultSource?: unknown
}): ResolvedSources => {
	const { sources, defaultSource } = options
	if (defaultSource !== undefined && !isDefaultRule(defaultSource)) {
		throw new Error(
			`analytics: defaultSource must be 'tenantFirst', 'platformFirst' or a function, got ${kindOf(defaultSource)}`
		)
	}
	if (defaultSource === 'platformFirst' && options.platformAdapter === undefined) {
		throw new Error(
			"analytics: defaultSource 'platformFirst' opens each tenant on the platformAdapter, which is not set; set platformAdapter or pick another rule"
		)
	}
	const policies = new Map<string, Exclude<SourcePolicy, 'staff'>>()
	if (sources !== undefined && (!isRecord(sources) || Array.isArray(sources))) {
		throw new Error(
			`analytics: sources must be an object keyed by adapter id, such as { posthog: { tenants: 'fallback' } }, got ${kindOf(sources)}`
		)
	}
	const adapters = options.adapters ?? []
	if (adapters.length > 0) {
		for (const [id, entry] of Object.entries(sources ?? {})) {
			if (entry === undefined) {
				continue
			}
			const adapter = adapters.find((candidate) => candidate.id === id)
			if (!adapter) {
				throw new Error(
					`analytics: sources.${id} names no adapter in adapters, whose ids are ${listOf(adapters.map((known) => `"${known.id}"`))}; sources is keyed by the id of a config adapter`
				)
			}
			const policy = resolvePolicy(id, entry, adapter)
			if (policy !== undefined) {
				policies.set(id, policy)
			}
		}
	}
	return { policies, ...(defaultSource === undefined ? {} : { defaultSource }) }
}
