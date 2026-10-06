import type { Access, PayloadRequest } from 'payload'
import type { PlatformReadAccess } from '../core/options'

export interface ProviderAccessArgs {
	/** True when the install configured a scopeResolver. */
	scoped: boolean
	scopeField: string
	resolveScope: (req: PayloadRequest) => Promise<string | null>
	platformRead: PlatformReadAccess
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
 * Row access (read/update/delete) for the provider collection. Unscoped
 * installs keep the historical any-authenticated-user behavior. Scoped
 * installs constrain every row operation to the request's resolved scope via
 * a where clause (so list views filter instead of erroring); the platformRead
 * gate lifts the constraint for platform admins. A null or unresolvable scope
 * fails closed.
 */
export const providerRowAccess = (args: ProviderAccessArgs): Access => {
	return async ({ req }) => {
		if (!req.user) return false
		if (!args.scoped) return true
		if (await args.platformRead({ req })) return true
		const scope = await resolveOrNull(args, req)
		if (scope === null) return false
		return { [args.scopeField]: { equals: scope } }
	}
}

/**
 * Create access: any authenticated user in unscoped installs; in scoped
 * installs the requester needs a resolved scope (the stamp hook writes it) or
 * the platform grant (install-wide providers have no scope to resolve).
 */
export const providerCreateAccess = (args: ProviderAccessArgs): Access => {
	return async ({ req }) => {
		if (!req.user) return false
		if (!args.scoped) return true
		if (await args.platformRead({ req })) return true
		return (await resolveOrNull(args, req)) !== null
	}
}
