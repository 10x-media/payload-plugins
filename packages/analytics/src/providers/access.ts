import type { Access, PayloadRequest } from 'payload'
import { isAdminUser } from '../access/adminUser'
import { isScopeMember } from '../access/membership'
import type { CrossScopeAccess, ScopeMemberAccess } from '../core/options'

export interface ProviderAccessArgs {
	/** True when the install configured `scope.resolve`. */
	scoped: boolean
	scopeField: string
	/** The plugin's `scope.resolve` at the `admin` call site. */
	resolveScope: (req: PayloadRequest) => Promise<string | null>
	/** `scope.member`: whether the request's user belongs to the scope it resolved. */
	member?: ScopeMemberAccess
	/** `access.crossScope.named`: acting on a scope other than the request's own. */
	crossScope: CrossScopeAccess
}

const resolveOrNull = async (
	args: ProviderAccessArgs,
	req: PayloadRequest
): Promise<string | null> => {
	try {
		const scope = await args.resolveScope(req)
		return scope === '' ? null : scope
	} catch {
		return null
	}
}

/**
 * The request's resolved scope while its user belongs to it, else null, so a tenant selector
 * pointed at someone else's tenant opens nothing.
 */
export const memberScopeOf = async (
	args: ProviderAccessArgs,
	req: PayloadRequest
): Promise<string | null> => {
	const scope = await resolveOrNull(args, req)
	if (scope === null) {
		return null
	}
	return (await isScopeMember(args.member, req, scope)) ? scope : null
}

/**
 * What every operation shares: admin-collection users only, everything on an unscoped install or
 * under the cross-scope grant; undefined leaves it to the request's member scope.
 */
const sharedVerdict = async (
	args: ProviderAccessArgs,
	req: PayloadRequest
): Promise<boolean | undefined> => {
	if (!isAdminUser({ req })) return false
	if (!args.scoped) return true
	if (await args.crossScope({ req })) return true
	return undefined
}

/**
 * Admin-collection users only. Scoped installs constrain rows to the request's member scope with a
 * where clause (list views filter, not error) unless the cross-scope grant lifts it.
 */
export const providerRowAccess =
	(args: ProviderAccessArgs): Access =>
	async ({ req }) => {
		const verdict = await sharedVerdict(args, req)
		if (verdict !== undefined) return verdict
		const scope = await memberScopeOf(args, req)
		if (scope === null) return false
		return { [args.scopeField]: { equals: scope } }
	}

/**
 * Admin-collection users only. Scoped installs need a member scope (the stamp hook writes it) or
 * the cross-scope grant, since install-wide providers have no scope to resolve.
 */
export const providerCreateAccess =
	(args: ProviderAccessArgs): Access =>
	async ({ req }) => {
		const verdict = await sharedVerdict(args, req)
		if (verdict !== undefined) return verdict
		return (await memberScopeOf(args, req)) !== null
	}
