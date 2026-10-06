import { fields } from '@10x-media/fields'
import { multiTenantPlugin } from '@payloadcms/plugin-multi-tenant'
import { getTenantFromCookie, getUserTenantIDs } from '@payloadcms/plugin-multi-tenant/utilities'
import type { CollectionConfig, PayloadRequest } from 'payload'
import { analytics, type ScopesResolver } from '../../src/index'
import { native } from '../../src/native/nativeAdapter'
import { devMemoryAdapter } from '../helpers/adapters'
import {
	DEV_REPORTING_TIMEZONE,
	type DevConfigFragment,
	sharedBindings,
	sharedDashboardLayout,
	sharedGoals,
	sharedWidgets,
} from './shared'

const PLATFORM_EMAIL = 'dev@10xmedia.de'

/** The multi-tenant plugin's own relationship field, which scopes `analytics-providers`. */
const TENANT_SCOPE_FIELD = 'tenant'

/**
 * The field `analytics-goals` scopes on: the plugin's own, since that collection is not
 * registered with the multi-tenant plugin. Exported so the seed stamps the same key the
 * resolver reads instead of hard-coding one.
 */
export const GOAL_SCOPE_FIELD = 'scope'

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

/**
 * Resolves an anonymous request's tenant from its hostname: the first label of the `host`
 * header names the tenant slug (`alpha.localhost:4123` -> `alpha`). An unknown or missing
 * host falls closed to the install-wide null scope rather than guessing a tenant.
 */
const tenantIdForHost = async (req: PayloadRequest): Promise<string | null> => {
	const label = req.headers.get('host')?.split(':')[0]?.split('.')[0]
	if (!label) {
		return null
	}
	const { docs } = await req.payload.find({
		collection: 'tenants' as never,
		where: { slug: { equals: label } },
		limit: 1,
		depth: 0,
		overrideAccess: true,
	})
	const tenant = docs[0] as { id: string | number } | undefined
	return tenant ? String(tenant.id) : null
}

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
			// No capture.slots override here: the tenant slot resolves to the scope's default
			// adapter (native) on a recognized host, and the global slot stays empty because it
			// falls to `platformAdapter`, the memory demo source, which declares no capture
			// support. So an unrecognized host captures nothing at all.
			// The plugin's own `scope` field, not the multi-tenant `tenant` relationship the
			// providers collection uses: see the multiTenantPlugin note below.
			goals: { defaults: sharedGoals, collection: { scopeField: GOAL_SCOPE_FIELD } },
			providers: { collection: { scopeField: TENANT_SCOPE_FIELD } },
			widgets: sharedWidgets,
			// Two branches, because the two callers look nothing alike. A signed-in admin is
			// attributed by the tenant-selector cookie, validated against the user's own
			// tenants: never trust a client-set value alone, which a real install must do too.
			// Public tracker and ingest requests carry no session at all, so those resolve by
			// hostname label (alpha.localhost -> the tenant whose slug is "alpha") and fail
			// closed to the null scope; a real install resolves them by hostname or site key
			// the same way. A session always wins: an admin browsing alpha.localhost is still
			// attributed by their own selector, never by the host they happen to be on.
			scopeResolver: async ({ req }) => {
				if (!req.user) {
					return await tenantIdForHost(req)
				}
				const t = getTenantFromCookie(req.headers, req.payload.db.defaultIDType)
				const email = (req.user as { email?: string } | undefined)?.email
				if (email === PLATFORM_EMAIL) {
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
		//
		// Only providers are registered here, on purpose.
		//
		// `analytics-goals` was tried with `scopeField: 'tenant'` and reverted: with it
		// registered, a tenant user's `/admin` never finished loading and both @tenancy specs
		// that open the admin as one timed out, including `tenancy.e2e.spec.ts` "dashboard
		// pageviews are isolated per tenant", which this change does not otherwise touch;
		// removing the entry made them pass again. The likely path is that goals then resolve
		// through this plugin's access and base filter on a first render that has no
		// `payload-tenant` cookie yet, which makes the scope resolver below throw, but that
		// mechanism is unconfirmed. Goals therefore scope on the plugin's own `scope` field,
		// which is the shape any scoped install without a tenant plugin gets anyway.
		//
		// `pages` is not registered either: this plugin's tenant field is required, and the dev
		// seed shares one set of pages across both tenants so the same five paths carry alpha's
		// and beta's traffic. Registering it makes every page tenant-owned, which the boot seed
		// cannot satisfy ("The following field is invalid: Assigned Tenant") and which the
		// capture and tenancy e2e specs, both reading the single `home` document under either
		// scope, depend on not being true.
		multiTenantPlugin({
			collections: { 'analytics-providers': { isGlobal: true } },
			userHasAccessToAllTenants: (user) => user?.email === PLATFORM_EMAIL,
		}),
	],
	dashboard: { widgets: [], defaultLayout: sharedDashboardLayout },
}
