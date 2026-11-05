import { isAdminUser } from '../access/adminUser'
import type { ScopeDecision } from '../plugin/runtime'
import { PLATFORM_SCOPE } from './contract'
import { keysOf, optionalFunction, optionsObject } from './optionChecks'
import type {
	AnalyticsAccessOptions,
	AnalyticsPluginOptions,
	AnalyticsReadAccess,
	AnalyticsScopeOptions,
	CrossScopeAccess,
	ResolvedCrossScope,
	ResolvedOptions,
	ResolvedScope,
	ScopeResolver,
} from './options'
import { isRecord, kindOf } from './values'

const SCOPE_KEYS = keysOf<AnalyticsScopeOptions>({
	resolve: true,
	member: true,
	list: true,
	label: true,
})

const ACCESS_KEYS = keysOf<AnalyticsAccessOptions>({ read: true, view: true, crossScope: true })

const CROSS_SCOPE_GATES = keysOf<Record<ScopeDecision, true>>({
	named: true,
	aggregate: true,
	unscopedSource: true,
})

const MEMBER_REQUIRED =
	"analytics: scope.member is required with scope.resolve. scope.resolve picks which scope a request is for; scope.member decides whether its user belongs to that scope, and every read and every write to the plugin's collections asks it. With @payloadcms/plugin-multi-tenant, pass tenantMembership() from '@10x-media/analytics'. Pass () => true only when scope.resolve derives the scope from req.user itself, so a user can never select a scope they do not belong to."

/** One access function for all three cross-scope gates, which is what the function form means. */
export const allCrossScope = (access: CrossScopeAccess): ResolvedCrossScope => ({
	named: access,
	aggregate: access,
	unscopedSource: access,
})

/** The `'*'` marker is a reader's request for every scope, never a request's own scope. */
const refusingWildcard =
	(resolve: ScopeResolver): ScopeResolver =>
	async (args) => {
		const scope = await resolve(args)
		if (scope === PLATFORM_SCOPE) {
			throw new Error(
				`analytics: scope.resolve returned "${PLATFORM_SCOPE}", which names every scope at once; return one scope id, or null for the install-wide scope`
			)
		}
		return scope
	}

/** `scope`: unset resolves every request to the install-wide scope; set, it needs `member`. */
export const resolveScope = (option: AnalyticsPluginOptions['scope']): ResolvedScope => {
	if (option !== undefined) {
		optionsObject(option, {
			path: 'scope',
			known: SCOPE_KEYS,
			example: 'an object such as { resolve, member }',
		})
	}
	const resolve = optionalFunction(option?.resolve, 'scope.resolve')
	const list = optionalFunction(option?.list, 'scope.list')
	const label = optionalFunction(option?.label, 'scope.label')
	const member = optionalFunction(option?.member, 'scope.member')
	if (!resolve) {
		return { resolve: () => null }
	}
	if (member === undefined) {
		throw new Error(MEMBER_REQUIRED)
	}
	return {
		resolve: refusingWildcard(resolve),
		member,
		...(list ? { list } : {}),
		...(label ? { label } : {}),
	}
}

/**
 * Refuses the options that only mean something on a scoped install: an unscoped config carrying one
 * almost always forgot `scope.resolve`, so it fails the boot rather than doing nothing.
 */
export const assertScopedOnlyOptions = (options: AnalyticsPluginOptions): void => {
	const paths: string[] = []
	for (const key of ['list', 'label', 'member'] as const) {
		if (options.scope?.[key] !== undefined) {
			paths.push(`scope.${key}`)
		}
	}
	if (options.access?.crossScope !== undefined) {
		paths.push('access.crossScope')
	}
	for (const key of ['sources', 'defaultSource'] as const) {
		if (options[key] !== undefined) {
			paths.push(key)
		}
	}
	if (typeof options.capture?.slots?.tenant === 'string') {
		paths.push('capture.slots.tenant')
	}
	if (options.capture?.paths?.tenant !== undefined) {
		paths.push('capture.paths.tenant')
	}
	for (const [slug, binding] of Object.entries(options.collections ?? {})) {
		if (binding?.scopeField !== undefined && binding.scopeField !== false) {
			paths.push(`collections.${slug}.scopeField`)
		}
	}
	const goalsCollection = Array.isArray(options.goals) ? undefined : options.goals?.collection
	if (isRecord(goalsCollection) && goalsCollection.scopeField !== undefined) {
		paths.push('goals.collection.scopeField')
	}
	const providersCollection = options.providers?.collection
	if (isRecord(providersCollection) && providersCollection.scopeField !== undefined) {
		paths.push('providers.collection.scopeField')
	}
	if (isRecord(providersCollection) && providersCollection.fields?.isDefault !== undefined) {
		paths.push('providers.collection.fields.isDefault')
	}
	if (paths.length > 0) {
		const one = paths.length === 1
		throw new Error(
			`analytics: ${paths.join(', ')} ${one ? 'only applies' : 'only apply'} to a scoped install. Set scope.resolve, or remove ${one ? 'it' : 'them'}.`
		)
	}
}

/** Unset gates deny on a scoped install and admit `isAdminUser` on an unscoped one. */
const resolveCrossScope = (
	option: AnalyticsAccessOptions['crossScope'],
	scoped: boolean
): ResolvedCrossScope => {
	const fallback: CrossScopeAccess = scoped ? () => false : isAdminUser
	if (option === undefined) {
		return allCrossScope(fallback)
	}
	if (typeof option === 'function') {
		return allCrossScope(option)
	}
	if (!isRecord(option)) {
		throw new Error(
			`analytics: access.crossScope must be a function or an object, got ${kindOf(option)}`
		)
	}
	for (const [gate, access] of Object.entries(option)) {
		if (!CROSS_SCOPE_GATES.includes(gate)) {
			throw new Error(
				`analytics: access.crossScope has no "${gate}" gate; the gates are named, aggregate and unscopedSource`
			)
		}
		if (access !== undefined && typeof access !== 'function') {
			throw new Error(`analytics: access.crossScope.${gate} must be a function`)
		}
	}
	return {
		named: option.named ?? fallback,
		aggregate: option.aggregate ?? fallback,
		unscopedSource: option.unscopedSource ?? fallback,
	}
}

/** `access`: the read gate, the view gate (the read gate unless set) and the cross-scope gates. */
export const resolveAccess = (
	option: AnalyticsAccessOptions | undefined,
	scoped: boolean
): ResolvedOptions['access'] => {
	if (option !== undefined) {
		optionsObject(option, {
			path: 'access',
			known: ACCESS_KEYS,
			example: 'an object such as { read: isAdminUser }',
		})
	}
	const read: AnalyticsReadAccess = optionalFunction(option?.read, 'access.read') ?? isAdminUser
	return {
		read,
		view: optionalFunction(option?.view, 'access.view') ?? read,
		crossScope: resolveCrossScope(option?.crossScope, scoped),
	}
}
