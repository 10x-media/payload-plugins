import type { PayloadRequest } from 'payload'
import { decideOnce } from '../access/decideOnce'
import { isScopeMember } from '../access/membership'
import {
	type GatedScope,
	isGatedScope,
	mintGatedScope,
	type ReadPrincipal,
	SYSTEM,
} from '../access/principal'
import { readGate } from '../access/readGate'
import { readableProviderDocIds } from '../plugin/readableProviders'
import { requestMemo } from '../plugin/requestMemo'
import {
	type AnalyticsRuntime,
	resolvableScope,
	resolveRegistryFor,
	resolveScopeFor,
	type ScopeGates,
	scopeGates,
} from '../plugin/runtime'
import { MAX_SCOPE_LENGTH } from '../query/limits'
import { type AnalyticsAdapter, PLATFORM_SCOPE } from './contract'
import {
	type AdapterRegistry,
	createRegistry,
	filterRegistry,
	type ScopeRegistry,
} from './registry'
import { sourceLabelFor, sourceRefFor } from './sourceLabel'
import type { DefaultSourceFunction, SourceRef } from './sourcePolicy'

export type ReadContext =
	| {
			ok: true
			adapter: AnalyticsAdapter
			scope: string | null
			/** The scope to stamp on the adapter query; undefined for install-wide reads. */
			queryScope?: string
			/**
			 * The read's principal and scope, for the reads it makes on its behalf: handing this on
			 * keeps every one of them on exactly this scope without deciding it again.
			 */
			pin: ReadPrincipal
			/** The source asked for, which this reader cannot read, when the scope default read instead. */
			substitutedFrom?: string
	  }
	| {
			ok: false
			/**
			 * Why the read was refused: `no-sources` (nothing this reader may read), `no-access`,
			 * `not-member`, or `no-scope` (no single scope resolved, no cross-scope read).
			 */
			reason?: 'no-sources' | 'no-access' | 'not-member' | 'no-scope'
	  }

type ResolveReadContextArgs = {
	runtime: AnalyticsRuntime
	req: PayloadRequest
	adapterId?: string
	/**
	 * Without an `adapterId`, the source to read through is the scope's default when this accepts
	 * it, else the first visible source it accepts, else the default all the same.
	 */
	prefer?: (adapter: AnalyticsAdapter) => boolean
	/**
	 * An `adapterId` this reader cannot read is read as if none were named, the substitution
	 * reported as `substitutedFrom`: for a stored choice, never a caller's explicit one.
	 */
	fallbackWhenUnreadable?: boolean
} & ReadPrincipal

interface QueryScopeArgs {
	runtime: AnalyticsRuntime
	req: PayloadRequest
	/** The read's resolved scope; `'*'` is the explicit cross-scope marker. */
	scope: string | null
	adapter: AnalyticsAdapter
	/** Shared cross-scope decisions; one set is created per call when omitted. */
	gates?: ScopeGates
}

/**
 * A scope a request may act on, or why not: `named` and `unresolved` are denied cross-scope gates,
 * `failed` a throwing `scope.resolve`, `not-member` a scope its user does not belong to.
 */
export type RequestedScope =
	| {
			ok: true
			scope: string | null
			/** The same scope as a token the reads below accept without deciding it again. */
			gated: GatedScope
	  }
	| { ok: false; reason: 'named' | 'unresolved' | 'failed' | 'not-member' }

interface RequestedScopeArgs {
	runtime: AnalyticsRuntime
	req: PayloadRequest
	/** The `scope` the request carried, untrimmed; null or undefined when it carried none. */
	raw?: string | null
	/** Shared cross-scope decisions; one set is created per call when omitted. */
	gates?: ScopeGates
}

const cleared = (scope: string | null): RequestedScope => ({
	ok: true,
	scope,
	gated: mintGatedScope(scope),
})

/**
 * The scope one request may act on, for every endpoint taking a caller's `scope`, and the only
 * place a {@link GatedScope} is minted. A scoped install's null, no tenant selected, fails closed.
 */
export const resolveRequestedScope = async (args: RequestedScopeArgs): Promise<RequestedScope> => {
	const { runtime, req } = args
	const gates = args.gates ?? scopeGates(runtime, req)
	const named = typeof args.raw === 'string' ? args.raw.trim() : ''
	if (named !== '') {
		// The wildcard is never the request's own scope in this sense: it names every scope,
		// whatever the resolver answered, and stays behind the aggregate gate.
		if (named === PLATFORM_SCOPE) {
			return (await gates.aggregate({ scope: PLATFORM_SCOPE }))
				? cleared(named)
				: { ok: false, reason: 'named' }
		}
		// An install without tenants has no scope to name, and no tenant id runs this long.
		if (runtime.scoped !== true || named.length > MAX_SCOPE_LENGTH) {
			return { ok: false, reason: 'named' }
		}
		if (await gates.named({ scope: named })) {
			return cleared(named)
		}
		// Only after the gate has said no, so a platform reader still costs one resolution.
		const own = await resolveScopeFor(runtime, req).catch(() => null)
		if (own === null || own === PLATFORM_SCOPE || own !== named) {
			return { ok: false, reason: 'named' }
		}
		return (await isScopeMember(runtime.member, req, own))
			? cleared(own)
			: { ok: false, reason: 'not-member' }
	}
	let scope: string | null
	try {
		scope = await resolveScopeFor(runtime, req)
	} catch {
		return { ok: false, reason: 'failed' }
	}
	if (scope === PLATFORM_SCOPE || scope === null) {
		const crossScope = scope === PLATFORM_SCOPE || runtime.scoped === true
		return crossScope && !(await gates.aggregate({ scope }))
			? { ok: false, reason: 'unresolved' }
			: cleared(scope)
	}
	if ((await isScopeMember(runtime.member, req, scope)) || (await gates.named({ scope }))) {
		return cleared(scope)
	}
	return { ok: false, reason: 'not-member' }
}

/**
 * True for a shared config adapter that cannot narrow its query, read under a tenant scope: it
 * would answer with every scope's data, so reading or listing it takes `unscopedSource`.
 */
export const needsUnscopedSourceAccess = (
	runtime: AnalyticsRuntime,
	adapter: AnalyticsAdapter,
	scope: string | null
): boolean =>
	scope !== null &&
	scope !== PLATFORM_SCOPE &&
	runtime.configAdapterIds.has(adapter.id) &&
	!adapter.capabilities.scopedQueries

/**
 * {@link SYSTEM} reads any scope, but never a tenant through a shared adapter that cannot narrow
 * to it: a job would store that adapter's install-wide numbers as the tenant's own.
 */
const SYSTEM_GATES: ScopeGates = {
	named: () => Promise.resolve(true),
	aggregate: () => Promise.resolve(true),
	unscopedSource: () => Promise.resolve(false),
}

interface VisibleArgs {
	runtime: AnalyticsRuntime
	req: PayloadRequest
	resolved: ScopeRegistry
	scope: string | null
	gates?: ScopeGates
	principal?: typeof SYSTEM
}

/** The adapters one reader sees in a scope, and which of them a `fallback` policy alone admitted. */
export interface VisibleSources {
	registry: AdapterRegistry | null
	/** Shared adapters listed only because a `fallback` policy let a member of the scope in. */
	fallbackAdmitted: ReadonlySet<string>
}

const NONE_ADMITTED: ReadonlySet<string> = new Set()

/** A source the reader reads a scope through by one of the scope's own provider documents. */
interface Granted {
	adapter: AnalyticsAdapter
	docId: string
}

/**
 * Whether `sources.<id>.tenants` lets this member of `scope` read through a shared adapter none
 * of its documents grants; asked once per request, scope and adapter. A policy that throws denies.
 */
const policyAdmits = async (args: {
	runtime: AnalyticsRuntime
	req: PayloadRequest
	scope: string
	adapter: AnalyticsAdapter
	own: readonly Granted[]
}): Promise<boolean> => {
	const { runtime, req, scope, adapter, own } = args
	const policy = runtime.sourcePolicies?.get(adapter.id)
	// The boot refuses a policy on an adapter that cannot narrow; a tenant must never read totals
	// spanning every tenant, so a runtime built any other way is held to it too.
	if (
		policy === undefined ||
		!runtime.configAdapterIds.has(adapter.id) ||
		adapter.capabilities.scopedQueries !== true ||
		!(await isScopeMember(runtime.member, req, scope))
	) {
		return false
	}
	return decideOnce(req, {
		owner: runtime,
		key: `sourcePolicy:${JSON.stringify(scope)}:${adapter.id}`,
		decide: async () => {
			if (policy === 'tenant') {
				return true
			}
			if (policy === 'fallback') {
				return own.length === 0
			}
			try {
				const ownSources = await Promise.all(
					own.map(async (granted) => ({
						id: granted.adapter.id,
						label: await sourceLabelFor(granted.adapter, { req, scope }),
						docId: granted.docId,
					}))
				)
				return (await policy({ req, scope, adapterId: adapter.id, ownSources })) === true
			} catch (err) {
				req.payload.logger?.warn(
					`analytics: sources.${adapter.id}.tenants threw for scope "${scope}", which counts as no: ${String(err)}`
				)
				return false
			}
		},
	})
}

const pickedDefaults = requestMemo<string | undefined>('defaultSources')

/** The `defaultSource` function's pick, asked once per request, scope and set of sources. */
const pickDefault = (args: {
	runtime: AnalyticsRuntime
	req: PayloadRequest
	resolved: ScopeRegistry
	scope: string
	visible: AdapterRegistry
	pick: DefaultSourceFunction
}): Promise<string | undefined> => {
	const { runtime, req, resolved, scope, visible, pick } = args
	const listed = visible.all()
	return pickedDefaults(req, {
		owner: pick,
		key: `${JSON.stringify(scope)}:${listed.map((adapter) => adapter.id).join(',')}`,
		compute: async () => {
			try {
				const sources: SourceRef[] = await Promise.all(
					listed.map((adapter) =>
						sourceRefFor(adapter, {
							req,
							scope,
							configIds: runtime.configAdapterIds,
							docId: resolved.grants.get(adapter.id),
						})
					)
				)
				return await pick({ req, scope, sources })
			} catch (err) {
				req.payload.logger?.warn(
					`analytics: defaultSource threw for scope "${scope}", which keeps the default: ${String(err)}`
				)
				return undefined
			}
		},
	})
}

interface ScopeDefaultArgs {
	runtime: AnalyticsRuntime
	req: PayloadRequest
	resolved: ScopeRegistry
	scope: string
	visible: AdapterRegistry
}

/**
 * A tenant scope's default among the sources a reader sees: its document flagged the default, else
 * the `defaultSource` rule's pick, else undefined for the registry's own.
 */
const scopeDefaultId = async (args: ScopeDefaultArgs): Promise<string | undefined> => {
	const { runtime, resolved, visible } = args
	const all = visible.all()
	const sees = (id: string | undefined): id is string =>
		id !== undefined && all.some((adapter) => adapter.id === id)
	if (sees(resolved.defaultGrant)) {
		return resolved.defaultGrant
	}
	const rule = runtime.defaultSource
	if (rule === undefined) {
		return undefined
	}
	if (rule === 'tenantFirst') {
		return all.find((adapter) => resolved.grants.has(adapter.id))?.id
	}
	if (rule === 'platformFirst') {
		return sees(runtime.platformAdapterId) ? runtime.platformAdapterId : undefined
	}
	const picked = await pickDefault({ ...args, pick: rule })
	return sees(picked) ? picked : undefined
}

/** `visible` reading through the scope's chosen default; the very registry when it already does. */
const withScopeDefault = async (
	args: Omit<ScopeDefaultArgs, 'visible'> & { visible: AdapterRegistry | null }
): Promise<AdapterRegistry | null> => {
	const { visible } = args
	if (!visible) {
		return null
	}
	const chosen = await scopeDefaultId({ ...args, visible })
	return chosen === undefined || chosen === visible.default().id
		? visible
		: createRegistry(visible.all(), chosen)
}

/**
 * {@link visibleRegistryFor}, also naming the shared adapters only a `fallback` policy admitted,
 * which a listing says so about.
 */
export const visibleSourcesFor = async (args: VisibleArgs): Promise<VisibleSources> => {
	const { runtime, req, resolved, scope } = args
	const { registry, grants } = resolved
	if (runtime.scoped !== true || scope === null || scope === PLATFORM_SCOPE) {
		return { registry, fallbackAdmitted: NONE_ADMITTED }
	}
	if (args.principal === SYSTEM) {
		const visible = filterRegistry(
			registry,
			(adapter) => grants.has(adapter.id) || !needsUnscopedSourceAccess(runtime, adapter, scope)
		)
		return {
			registry: await withScopeDefault({ runtime, req, resolved, scope, visible }),
			fallbackAdmitted: NONE_ADMITTED,
		}
	}
	const gates = args.gates ?? scopeGates(runtime, req)
	const readable = await readableProviderDocIds(runtime, req, scope)
	const own: Granted[] = []
	for (const adapter of registry.all()) {
		const docId = grants.get(adapter.id)
		if (docId !== undefined && (readable === null || readable.has(docId))) {
			own.push({ adapter, docId })
		}
	}
	const keep = new Set(own.map((granted) => granted.adapter.id))
	const fallbackAdmitted = new Set<string>()
	for (const adapter of registry.all()) {
		if (grants.has(adapter.id)) {
			continue
		}
		if (!runtime.providersCollection && adapter.capabilities.scopedQueries) {
			keep.add(adapter.id)
			continue
		}
		if (await gates.unscopedSource({ scope, adapterId: adapter.id })) {
			keep.add(adapter.id)
			continue
		}
		if (await policyAdmits({ runtime, req, scope, adapter, own })) {
			keep.add(adapter.id)
			if (runtime.sourcePolicies?.get(adapter.id) === 'fallback') {
				fallbackAdmitted.add(adapter.id)
			}
		}
	}
	const visible = filterRegistry(registry, (adapter) => keep.has(adapter.id))
	return {
		registry: await withScopeDefault({ runtime, req, resolved, scope, visible }),
		fallbackAdmitted,
	}
}

/**
 * The adapters a request may read through in one tenant scope, or null for none: the scope's own
 * sources follow the providers' read access (`sourceAccess`), a config adapter `unscopedSource` or
 * its `sources` policy. A tenant scope reads through its chosen default (see `defaultSource`).
 */
export const visibleRegistryFor = async (args: VisibleArgs): Promise<AdapterRegistry | null> =>
	(await visibleSourcesFor(args)).registry

/**
 * The sources a job reads one scope through as {@link SYSTEM}, or null when the scope holds
 * none: exactly what `resolveReadContext` lets a system read choose from.
 */
export const systemRegistryFor = async (
	runtime: AnalyticsRuntime,
	req: PayloadRequest,
	scope: string | null
): Promise<AdapterRegistry | null> => {
	const resolved = await resolveRegistryFor(runtime, {
		payload: req.payload,
		req,
		scope: resolvableScope(scope),
	})
	return visibleRegistryFor({ runtime, req, resolved, scope, principal: SYSTEM })
}

/**
 * The scope to stamp on one adapter query, or a refusal. Every read path decides it here, so
 * widgets and the query endpoint cannot drift on what counts as cross-scope.
 */
export const resolveQueryScope = async (
	args: QueryScopeArgs
): Promise<{ ok: true; queryScope?: string } | { ok: false }> => {
	const { runtime, req, scope, adapter } = args
	const gates = args.gates ?? scopeGates(runtime, req)
	if (scope === PLATFORM_SCOPE) {
		return (await gates.aggregate({ scope })) ? { ok: true } : { ok: false }
	}
	if (scope === null) {
		return { ok: true }
	}
	if (needsUnscopedSourceAccess(runtime, adapter, scope)) {
		return (await gates.unscopedSource({ scope, adapterId: adapter.id }))
			? { ok: true }
			: { ok: false }
	}
	return { ok: true, queryScope: scope }
}

type PrincipalScope =
	| { ok: true; scope: string | null; pin: ReadPrincipal }
	| Extract<ReadContext, { ok: false }>

/**
 * The read's scope: the system's own, one already cleared, or the one the request asks for. Checked
 * at runtime, since a JavaScript caller or a cast can pass anything; anything else is refused.
 */
const principalScope = async (
	args: ResolveReadContextArgs,
	gates: ScopeGates
): Promise<PrincipalScope> => {
	const { scope } = args
	if (args.principal === SYSTEM) {
		return typeof scope === 'string' || scope === null
			? { ok: true, scope, pin: { principal: SYSTEM, scope } }
			: { ok: false }
	}
	if (isGatedScope(scope)) {
		return { ok: true, scope: scope.value, pin: { scope } }
	}
	if (scope !== undefined && scope !== null && typeof scope !== 'string') {
		return { ok: false }
	}
	const requested = await resolveRequestedScope({
		runtime: args.runtime,
		req: args.req,
		gates,
		raw: scope,
	})
	if (!requested.ok) {
		switch (requested.reason) {
			case 'not-member':
				return { ok: false, reason: 'not-member' }
			case 'named':
				return { ok: false, reason: 'no-access' }
			case 'unresolved':
				return { ok: false, reason: 'no-scope' }
			case 'failed':
				return { ok: false }
		}
	}
	return { ok: true, scope: requested.scope, pin: { scope: requested.gated } }
}

/**
 * One read's scope and adapter, behind `access.read` and `resolveRequestedScope` unless the
 * principal is {@link SYSTEM}. Any failure answers `{ ok: false }`, so a surface never throws.
 */
export const resolveReadContext = async (args: ResolveReadContextArgs): Promise<ReadContext> => {
	const { runtime, req, adapterId } = args
	const system = args.principal === SYSTEM
	const gates = system ? SYSTEM_GATES : scopeGates(runtime, req)
	try {
		if (!system && !(await readGate(runtime, req))) {
			return { ok: false, reason: 'no-access' }
		}
		const decided = await principalScope(args, gates)
		if (!decided.ok) {
			return decided
		}
		const { scope, pin } = decided
		const registryScope = resolvableScope(scope)
		const resolved = await resolveRegistryFor(runtime, {
			payload: req.payload,
			req,
			scope: registryScope,
		})
		// The default is picked out of what this reader may actually read, so a scope whose
		// leading source is the platform's own shared one still serves a tenant admin.
		const registry = await visibleRegistryFor({
			runtime,
			req,
			resolved,
			scope,
			gates,
			...(system ? { principal: SYSTEM } : {}),
		})
		if (!registry) {
			return { ok: false, reason: 'no-sources' }
		}
		const fallback = registry.default()
		const preferred =
			args.prefer && !args.prefer(fallback) ? registry.all().find(args.prefer) : undefined
		const substitutedFrom =
			adapterId && args.fallbackWhenUnreadable && !registry.all().some((a) => a.id === adapterId)
				? adapterId
				: undefined
		const adapter =
			adapterId && substitutedFrom === undefined ? registry.get(adapterId) : (preferred ?? fallback)
		const decision = await resolveQueryScope({
			runtime,
			req,
			scope,
			adapter,
			gates,
		})
		if (!decision.ok) {
			return { ok: false }
		}
		return {
			ok: true,
			adapter,
			scope: registryScope,
			queryScope: decision.queryScope,
			pin,
			...(substitutedFrom === undefined ? {} : { substitutedFrom }),
		}
	} catch (err) {
		req.payload.logger?.warn(`analytics: read context resolution failed: ${String(err)}`)
		return { ok: false }
	}
}
