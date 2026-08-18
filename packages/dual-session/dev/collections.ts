import type { Access, CollectionConfig, GlobalConfig, PayloadRequest } from 'payload'

import { devSsoCallback, devSsoStrategy } from './sso'

/** Only the collection that backs the admin panel passes. */
export const adminOnly: Access = ({ req }) => req.user?.collection === 'users'

/** Any resolved session passes, whichever cookie it came from. */
const anySession: Access = ({ req }) => Boolean(req.user)

/**
 * Stamps every write with the session it was attributed to, so the frontend can see
 * which cookie the request actually authenticated against.
 */
const stampWriter = ({ data, req }: { data: Record<string, unknown>; req: PayloadRequest }) => ({
	...data,
	lastTouchedBy: req.user ? `${req.user.collection}:${req.user.email ?? req.user.id}` : 'anonymous',
})

/** Backs the admin panel, so it keeps the shared `payload-token` cookie. */
export const users: CollectionConfig = {
	slug: 'users',
	auth: true,
	admin: { useAsTitle: 'email' },
	fields: [],
}

/**
 * Isolated onto a custom cookie name and listed first in the plugin's `collections`,
 * so a visitor holding both a partner and a customer session resolves as the partner.
 */
export const partners: CollectionConfig = {
	slug: 'partners',
	auth: true,
	admin: { useAsTitle: 'email' },
	fields: [{ name: 'company', type: 'text' }],
}

/**
 * Isolated onto the default `payload-customers-token`. Also carries a hand-rolled SSO
 * strategy next to password login, so both routes into one isolated collection are
 * exercised: the plugin's shadowed `/login` and a callback minting its own cookie.
 */
export const customers: CollectionConfig = {
	slug: 'customers',
	auth: { strategies: [devSsoStrategy] },
	admin: { useAsTitle: 'email' },
	fields: [{ name: 'name', type: 'text' }],
	endpoints: [
		devSsoCallback,
		{
			method: 'get',
			path: '/ping',
			// Declared before the plugin runs, so it must survive alongside the six
			// replacement auth endpoints the plugin prepends.
			handler: (req) =>
				Response.json({
					pong: true,
					user: req.user ? { collection: req.user.collection, email: req.user.email } : null,
				}),
		},
	],
}

/**
 * The write target. Reading needs any session; writing needs the admin collection, so a
 * frontend session is authenticated but still refused.
 */
export const notes: CollectionConfig = {
	slug: 'notes',
	access: {
		create: adminOnly,
		delete: adminOnly,
		read: anySession,
		update: adminOnly,
	},
	admin: { useAsTitle: 'title' },
	hooks: { beforeChange: [stampWriter] },
	fields: [
		{ name: 'title', type: 'text', required: true },
		{ name: 'touchCount', type: 'number', defaultValue: 0 },
		{ name: 'lastTouchedBy', type: 'text', admin: { readOnly: true } },
	],
}

/** Same access split as `notes`, through the global REST route instead. */
export const siteSettings: GlobalConfig = {
	slug: 'site-settings',
	access: {
		read: anySession,
		update: adminOnly,
	},
	hooks: { beforeChange: [stampWriter] },
	fields: [
		{ name: 'headline', type: 'text' },
		{ name: 'lastTouchedBy', type: 'text', admin: { readOnly: true } },
	],
}
