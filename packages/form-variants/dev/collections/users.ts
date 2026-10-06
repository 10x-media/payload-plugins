import type { Access, CollectionConfig, TypedUser } from 'payload'

export type DevUser = TypedUser & { role?: 'admin' | 'editor' }

export const isAdmin = (user: null | TypedUser | undefined): boolean =>
	(user as DevUser | null | undefined)?.role === 'admin'

export const adminOnly: Access = ({ req }) => isAdmin(req.user)

/**
 * Two roles: `admin` sees the native form and may switch, `editor` only ever gets the quick
 * form. The seed creates one of each.
 */
export const users: CollectionConfig = {
	slug: 'users',
	auth: true,
	admin: { useAsTitle: 'email' },
	fields: [
		{
			name: 'role',
			type: 'select',
			defaultValue: 'editor',
			options: [
				{ label: 'Admin', value: 'admin' },
				{ label: 'Editor', value: 'editor' },
			],
			required: true,
		},
	],
}
