import type { Access, CollectionConfig, TypedUser } from 'payload'

import { devSsoCallback, devSsoStrategy } from './sso'

/** Roles that may reach the admin panel. */
const STAFF_ROLES = ['admin', 'editor']

const rolesOf = (user: null | TypedUser | undefined) =>
	(user as { roles?: string[] } | null | undefined)?.roles ?? []

const hasStaffRole = (user: null | TypedUser | undefined) =>
	STAFF_ROLES.some((role) => rolesOf(user).includes(role))

/**
 * Host predicate for `access.impersonate`. Only `admin` may start a session;
 * editors are valid targets.
 */
export const canImpersonate = (user: null | TypedUser | undefined) =>
	rolesOf(user).includes('admin')

export const adminOnly: Access = ({ req }) => hasStaffRole(req.user)

/**
 * Admin collection. Staff reach `/admin`; `user` does not. Impersonating a
 * non-staff target is how the unauthorized-bar path is exercised later.
 */
export const users: CollectionConfig = {
	slug: 'users',
	access: { admin: ({ req }) => hasStaffRole(req.user) },
	auth: true,
	admin: { useAsTitle: 'name', defaultColumns: ['name', 'email', 'roles'] },
	fields: [
		{ name: 'name', type: 'text' },
		{
			name: 'roles',
			type: 'select',
			defaultValue: ['user'],
			hasMany: true,
			options: ['admin', 'editor', 'user'],
		},
	],
}

/**
 * Second local-auth collection, not isolated. Start against this collection is
 * swap mode: the minted cookie replaces `payload-token`.
 */
export const customers: CollectionConfig = {
	slug: 'customers',
	auth: true,
	admin: { useAsTitle: 'name' },
	fields: [{ name: 'name', type: 'text' }],
}

/**
 * Isolated by dual-session onto its own cookie. Start against this collection is
 * parallel mode: the admin session stays on `payload-token`.
 */
export const partners: CollectionConfig = {
	slug: 'partners',
	auth: true,
	admin: { useAsTitle: 'name' },
	fields: [{ name: 'name', type: 'text' }],
}

/**
 * SSO-only collection. No password login. Sessions exist (`enableFields`) so a
 * later `session.issue` / `revoke` / `binding` seam can mint without
 * `addSessionToUser` being refused. Excluded from default targets until those
 * seams are supplied.
 */
export const ssoUsers: CollectionConfig = {
	slug: 'sso-users',
	auth: {
		disableLocalStrategy: { enableFields: true, optionalPassword: true },
		strategies: [devSsoStrategy],
	},
	admin: { useAsTitle: 'email' },
	fields: [{ name: 'name', type: 'text' }],
	endpoints: [devSsoCallback],
}
