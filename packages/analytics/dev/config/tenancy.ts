import { fields } from '@10x-media/fields'
import { multiTenantPlugin } from '@payloadcms/plugin-multi-tenant'
import { getTenantFromCookie, getUserTenantIDs } from '@payloadcms/plugin-multi-tenant/utilities'
import type { CollectionConfig } from 'payload'
import { analytics, type ScopesResolver } from '../../src/index'
import { native } from '../../src/native/nativeAdapter'
import { devMemoryAdapter } from '../helpers/adapters'
import {
	DEV_REPORTING_TIMEZONE,
	type DevConfigFragment,
	sharedBindings,
	sharedDashboardLayout,
	sharedWidgets,
} from './shared'

const PLATFORM_EMAIL = 'dev@10xmedia.de'

const tenants: CollectionConfig = {
	slug: 'tenants',
	admin: { useAsTitle: 'name' },
	fields: [
		{ name: 'name', type: 'text', required: true },
		{ name: 'slug', type: 'text', required: true, unique: true },
	],
}

/**
 * Fans the warm/sync cron tiers and the sync-pass seed out over every tenant, in addition
 * to the install-wide scope every tier already covers on its own.
 */
export const tenancyScopes: ScopesResolver = async ({ payload }) =>
	(await payload.find({ collection: 'tenants' as never, pagination: false })).docs.map((doc) =>
		String((doc as { id: string | number }).id)
	)

/** The multi-tenant dev playground: a `tenants` collection scoping native events and providers. */
export const tenancyFragment: DevConfigFragment = {
	collections: [tenants],
	plugins: [
		fields({
			encrypted: {
				keys: { active: 'dev', keys: { dev: 'dev-only-key-material-32-bytes-minimum!!' } },
			},
		}),
		analytics({
			adapters: [native(), devMemoryAdapter],
			cache: { warm: true },
			sync: { hidden: false },
			reportingTimezone: DEV_REPORTING_TIMEZONE,
			collections: sharedBindings,
			providers: { collection: { scopeField: 'tenant' } },
			widgets: sharedWidgets,
			// Dev-only shortcut: attributing by the admin's tenant-selector cookie. A real
			// install must resolve ingest scope from the request's hostname or site key.
			// The validation below (the cookie must name one of the user's own tenants) is
			// what a real install must also do: never trust a client-set value alone.
			scopeResolver: ({ req }) => {
				const t = getTenantFromCookie(req.headers, req.payload.db.defaultIDType)
				const email = (req.user as { email?: string } | undefined)?.email
				if (!req.user || email === PLATFORM_EMAIL) {
					return t === null ? null : String(t)
				}
				const tenantIds = getUserTenantIDs(req.user).map(String)
				if (t !== null && tenantIds.includes(String(t))) {
					return String(t)
				}
				throw new Error('analytics dev: tenant user has no valid tenant selected')
			},
			platformAdapter: devMemoryAdapter.id,
			access: {
				platformRead: ({ req }) =>
					(req.user as { email?: string } | undefined)?.email === PLATFORM_EMAIL,
			},
			scopes: tenancyScopes,
		}),
		// Must run after analytics() so the analytics-providers collection it adds
		// already exists when this plugin scans config.collections for its target slug.
		multiTenantPlugin({
			collections: { 'analytics-providers': { isGlobal: true } },
			userHasAccessToAllTenants: (user) => user?.email === PLATFORM_EMAIL,
		}),
	],
	dashboard: { widgets: [], defaultLayout: sharedDashboardLayout },
}
