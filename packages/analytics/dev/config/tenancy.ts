import {
	analytics,
	analyticsTab,
	type ExclusionSitesResolver,
	type ScopeLabelResolver,
	type ScopeListResolver,
	type ScopeResolver,
	type TimezoneResolver,
	tenantMembership,
} from '@10x-media/analytics'
import { native } from '@10x-media/analytics/adapters/native'
import { fields } from '@10x-media/fields'
import { multiTenantPlugin } from '@payloadcms/plugin-multi-tenant'
import { getTenantFromCookie } from '@payloadcms/plugin-multi-tenant/utilities'
import type { CollectionConfig, Payload, PayloadRequest, TypedUser } from 'payload'
import { userTenantIds } from '../../src/access/membership'
import { isValidTimeZone } from '../../src/timeframe/tz'
import { devMemoryAdapter } from '../helpers/adapters'
import type { Tenant } from '../payload-types'
import {
	DEV_ADMIN_EMAIL,
	DEV_REPORTING_TIMEZONE,
	type DevConfigFragment,
	devSiteAddress,
	pagesBinding,
	sharedCustomizing,
	sharedDashboardLayout,
	sharedGate,
	sharedGoals,
	sharedRevenue,
	sharedSkip,
	sharedWidgets,
} from './shared'

/** The multi-tenant plugin's own answer, shared so analytics membership cannot drift from it. */
const userHasAccessToAllTenants = (user: TypedUser): boolean => user.email === DEV_ADMIN_EMAIL

const isPlatformStaff = ({ req }: { req: PayloadRequest }): boolean =>
	req.user ? userHasAccessToAllTenants(req.user) : false

/**
 * The multi-tenant plugin's relationship field, which scopes `analytics-providers` and
 * `analytics-goals` and which the seed stamps on the goals it creates.
 */
export const TENANT_SCOPE_FIELD = 'tenant'

const tenants: CollectionConfig = {
	slug: 'tenants',
	admin: { useAsTitle: 'name' },
	fields: [
		{ name: 'name', type: 'text', required: true },
		{ name: 'slug', type: 'text', required: true, unique: true },
		{
			name: 'timezone',
			type: 'text',
			defaultValue: DEV_REPORTING_TIMEZONE,
			admin: { description: 'The IANA timezone this tenant reports its analytics days in.' },
			validate: (value: unknown) =>
				value === null ||
				value === undefined ||
				value === '' ||
				(typeof value === 'string' && isValidTimeZone(value)) ||
				'An IANA timezone, such as Europe/Berlin',
		},
	],
}

const findTenant = (req: PayloadRequest, id: string): Promise<Tenant | null> =>
	req.payload
		.findByID({ collection: 'tenants', id, depth: 0, overrideAccess: true })
		.catch(() => null)

/**
 * The tenant a site host names by its first label (`alpha.localhost:4123` is alpha). Shared by
 * the scope resolver and the frontend, so a visit and the offer it sees agree on the tenant.
 */
export const tenantForHost = async (
	payload: Payload,
	host: string | null
): Promise<Tenant | undefined> => {
	const slug = host?.split(':')[0]?.split('.')[0]
	if (!slug) {
		return undefined
	}
	const { docs } = await payload.find({
		collection: 'tenants',
		where: { slug: { equals: slug } },
		limit: 1,
		depth: 0,
		overrideAccess: true,
	})
	return docs[0]
}

/** Each tenant reports in the zone its own document names; the platform's own scope in the dev zone. */
const tenantTimezone: TimezoneResolver = async ({ req, scope }) => {
	const tenant = scope === null ? null : await findTenant(req, scope)
	return tenant?.timezone || DEV_REPORTING_TIMEZONE
}

/**
 * The tenant-owned counterpart to the shared `pages`, bound as a content item: the frontend shows
 * its tenant's offer as a card on several pages, and its Analytics tab reports that card's views,
 * clicks and conversions for the owning tenant, whichever tenant the reader has selected.
 */
const offers: CollectionConfig = {
	slug: 'offers',
	labels: { singular: 'Offer', plural: 'Offers' },
	admin: { useAsTitle: 'title' },
	fields: [
		{
			type: 'tabs',
			tabs: [
				{
					label: 'Content',
					fields: [
						{ name: 'title', type: 'text', required: true },
						{ name: 'slug', type: 'text', required: true },
					],
				},
				analyticsTab(),
			],
		},
	],
}

/** Every tenant, which the warm and sync jobs cover beside the install-wide scope. */
export const tenancyScopes: ScopeListResolver = async ({ payload }) =>
	(await payload.find({ collection: 'tenants', pagination: false })).docs.map((doc) =>
		String(doc.id)
	)

/** Names the resolved scope in the view's caption; `access.crossScope` alone gates reads. */
const tenancyScopeLabel: ScopeLabelResolver = async ({ req, scope }) =>
	(await findTenant(req, scope))?.name

/** Each tenant's site, for the exclusion links; the platform's own scope has none. */
const tenantSites: ExclusionSitesResolver = async ({ req, scope }) => {
	const tenant = scope === null ? null : await findTenant(req, scope)
	return tenant?.slug ? [devSiteAddress(req, tenant.slug)] : []
}

/**
 * A visit (`capture`) is filed under the tenant whose host it landed on, or install-wide on an
 * unknown host; a signed-in admin under the tenant the selector names, else, as the multi-tenant
 * plugin's selector itself decides, the user's only tenant. Belonging is `scope.member`'s question.
 */
const resolveDevTenant: ScopeResolver = async ({ req, callSite }) => {
	if (callSite === 'capture') {
		const tenant = await tenantForHost(req.payload, req.headers.get('host'))
		return tenant ? String(tenant.id) : null
	}
	const selected = getTenantFromCookie(req.headers, req.payload.db.defaultIDType)
	if (selected !== null) {
		return String(selected)
	}
	const own = req.user && !userHasAccessToAllTenants(req.user) ? userTenantIds(req.user) : []
	return own.length === 1 ? (own[0] ?? null) : null
}

/** The multi-tenant dev playground: a `tenants` collection scoping native events and providers. */
export const tenancyFragment: DevConfigFragment = {
	collections: [tenants, offers],
	plugins: [
		fields({
			encrypted: {
				keys: { active: 'dev', keys: { dev: 'dev-only-key-material-32-bytes-minimum!!' } },
			},
		}),
		analytics({
			adapters: [native(), devMemoryAdapter],
			cache: { warm: true },
			sync: true,
			reportingTimezone: tenantTimezone,
			revenue: sharedRevenue,
			// Pages are shared by both tenants and carry no tenant field, so a page reports the
			// reader's own scope; an offer belongs to one tenant and reports that tenant's.
			collections: { pages: { ...pagesBinding, scopeField: false }, offers: { item: true } },
			// No `capture.slots`: a tenant captures through its own `native` provider document, and
			// the global slot falls to `platformAdapter`, which cannot capture, so an unknown host
			// captures nothing.
			capture: { gate: sharedGate, exclusion: { sites: tenantSites }, skip: sharedSkip },
			goals: { defaults: sharedGoals, collection: { scopeField: TENANT_SCOPE_FIELD } },
			providers: { collection: { scopeField: TENANT_SCOPE_FIELD } },
			widgets: sharedWidgets,
			...sharedCustomizing,
			scope: {
				resolve: resolveDevTenant,
				// The client-set selector cookie is never trusted on its own: membership is read
				// from the user's `tenants` array, by the same rules the multi-tenant plugin uses.
				member: tenantMembership({ userHasAccessToAllTenants }),
				list: tenancyScopes,
				label: tenancyScopeLabel,
			},
			platformAdapter: devMemoryAdapter.id,
			// Naming another tenant, aggregating across tenants and reading the platform's shared
			// source are separate grants; here they happen to go to the same staff account.
			access: {
				crossScope: {
					named: isPlatformStaff,
					aggregate: isPlatformStaff,
					unscopedSource: isPlatformStaff,
				},
			},
		}),
		// After analytics(), so the providers and goals collections it adds exist when this plugin
		// scans for its target slugs. Install-wide goals stay in `goals.defaults`: a registered
		// collection requires a tenant. `pages` is left out because the seed shares one set of
		// pages across both tenants, and not `isGlobal` because beta keeps two provider documents.
		multiTenantPlugin({
			collections: { 'analytics-providers': {}, 'analytics-goals': {}, offers: {} },
			userHasAccessToAllTenants,
		}),
	],
	dashboard: { widgets: [], defaultLayout: sharedDashboardLayout },
}
