import { GOALS_SLUG, signItemRef } from '@10x-media/analytics'
import { createLocalReq, type Payload, type PayloadRequest } from 'payload'
import { DEFAULT_JOBS } from '../../src/core/jobs'
import { getRuntime, resolveTimezoneFor } from '../../src/plugin/runtime'
import { syncTask } from '../../src/sync/syncTask'
import {
	DEV_ADMIN_EMAIL,
	DEV_REPORTING_CURRENCY,
	DEV_REPORTING_TIMEZONE,
	OFFER_GOAL,
	pagePath,
} from '../config/shared'
import { TENANT_SCOPE_FIELD, tenancyScopes } from '../config/tenancy'
import type { Tenant, User } from '../payload-types'
import { SEED_DAYS, seedTraffic } from './storeTraffic'
import type { SiteProfile } from './traffic'

/**
 * A seeded page or offer is stamped as created the day before its oldest seeded traffic, as a
 * real site's documents predate their visits; created at boot, every one without visits in a
 * window would read as new there.
 */
const seededCreatedAt = (): string =>
	new Date(Date.now() - (SEED_DAYS + 1) * 86_400_000).toISOString()

const DEV_PASSWORD = 'password'
const ALPHA_EMAIL = 'alpha@10xmedia.de'
const BETA_EMAIL = 'beta@10xmedia.de'

const SEED_PAGES = [
	// `home` is the site root through `pagePath`, so what happens on `/` has a document to
	// surface on.
	{ title: 'Home', slug: 'home' },
	{ title: 'About', slug: 'about' },
	{ title: 'Pricing', slug: 'pricing' },
	{ title: 'Blog', slug: 'blog' },
	{ title: 'Contact', slug: 'contact' },
]

/**
 * Each tenant reports in a zone of its own, so their days end at different instants: alpha on the
 * US west coast, beta in Berlin, and the platform itself in the dev app's own zone.
 */
const SEED_TENANTS = [
	{ slug: 'alpha', name: 'Alpha', timezone: 'America/Los_Angeles' },
	{ slug: 'beta', name: 'Beta', timezone: 'Europe/Berlin' },
] as const

type TenantKey = (typeof SEED_TENANTS)[number]['slug']
type SeededTenants = Record<TenantKey, Tenant>

/**
 * Seeds the `tenants` collection and resolves the alpha/beta docs either way. Idempotent: a tenant
 * from before tenants had a timezone is given its zone, and nothing else is touched.
 */
const seedTenants = async (payload: Payload): Promise<SeededTenants> => {
	const tenantCount = await payload.count({ collection: 'tenants' })
	if (tenantCount.totalDocs === 0) {
		for (const tenant of SEED_TENANTS) {
			await payload.create({ collection: 'tenants', data: { ...tenant } })
		}
		payload.logger.info(`Seeded tenants: ${SEED_TENANTS.map((t) => t.slug).join(', ')}`)
	}
	const found = (await payload.find({ collection: 'tenants', pagination: false })).docs
	for (const tenant of SEED_TENANTS) {
		const doc = found.find((t) => t.slug === tenant.slug)
		if (doc && !doc.timezone) {
			doc.timezone = tenant.timezone
			await payload.update({
				collection: 'tenants',
				id: doc.id,
				data: { timezone: tenant.timezone },
			})
		}
	}
	const alpha = found.find((t) => t.slug === 'alpha')
	const beta = found.find((t) => t.slug === 'beta')
	if (!alpha || !beta) {
		throw new Error('analytics dev seed: alpha/beta tenants missing after seeding')
	}
	return { alpha, beta }
}

/** Assigns `alpha@`/`beta@` to their tenant via the multi-tenant plugin's `tenants` array field. */
const seedTenantUsers = async (payload: Payload, tenants: SeededTenants): Promise<void> => {
	const assignments: Array<{ email: string; tenant: string }> = [
		{ email: ALPHA_EMAIL, tenant: tenants.alpha.id },
		{ email: BETA_EMAIL, tenant: tenants.beta.id },
	]
	for (const { email, tenant } of assignments) {
		const existing = await payload.count({
			collection: 'users',
			where: { email: { equals: email } },
		})
		if (existing.totalDocs === 0) {
			await payload.create({
				collection: 'users',
				data: { email, password: DEV_PASSWORD, tenants: [{ tenant }] },
			})
			payload.logger.info(`Seeded tenant admin: ${email} / ${DEV_PASSWORD}`)
		}
	}
}

type SeedProvider =
	| { tenantKey: TenantKey; provider: 'native'; name: string }
	| { tenantKey: TenantKey; provider: 'plausible'; name: string; siteId: string }

/**
 * Alpha stores its visits here and reads them here, and nothing else. Beta does the same and
 * also runs a Plausible project of its own, so the two tenants offer visibly different source
 * lists: one source and no picker for alpha, two and a picker for beta.
 */
const SEED_PROVIDERS: SeedProvider[] = [
	{ tenantKey: 'alpha', provider: 'native', name: 'Alpha site database' },
	{ tenantKey: 'beta', provider: 'native', name: 'Beta site database' },
	{ tenantKey: 'beta', provider: 'plausible', name: 'Beta Plausible', siteId: 'beta.example.com' },
]

/**
 * A tenant reads and captures native only with a `native` provider document, so each gets one.
 * Beta's Plausible document carries dummy credentials: its reads fail and degrade, which is
 * enough to show a second source in the picker. Created as the platform admin, so the scope
 * stamping hook accepts the explicit `tenant` rather than resolving one from a cookie-less req.
 */
const seedTenantProviders = async (
	payload: Payload,
	tenants: SeededTenants,
	platformAdmin: User
): Promise<void> => {
	const count = await payload.count({ collection: 'analytics-providers' })
	if (count.totalDocs > 0) {
		return
	}
	for (const entry of SEED_PROVIDERS) {
		await payload.create({
			collection: 'analytics-providers',
			data: {
				name: entry.name,
				provider: entry.provider,
				enabled: true,
				tenant: tenants[entry.tenantKey].id,
				...(entry.provider === 'plausible'
					? { plausible: { siteId: entry.siteId, apiKey: 'dev-dummy-api-key' } }
					: {}),
			},
			user: platformAdmin,
		})
	}
	payload.logger.info(`Seeded analytics-providers: ${SEED_PROVIDERS.map((p) => p.name).join(', ')}`)
}

/**
 * One tenant-owned document per tenant, shown on that tenant's pages as an offer card, so an
 * offer's Analytics tab has numbers on a fresh boot. Unlike the shared `pages`, these belong to
 * a tenant, which is the point: beta's admin opening alpha's offer is refused rather than shown
 * beta's numbers.
 */
const SEED_OFFERS = [
	{ tenantKey: 'alpha', title: 'Alpha offer', slug: 'alpha-offer' },
	{ tenantKey: 'beta', title: 'Beta offer', slug: 'beta-offer' },
] as const satisfies ReadonlyArray<{ tenantKey: TenantKey; title: string; slug: string }>

/** Stamped as the platform admin, for the reason {@link seedTenantProviders} gives. */
const seedTenantOffers = async (
	payload: Payload,
	tenants: SeededTenants,
	platformAdmin: User
): Promise<Partial<Record<TenantKey, string>>> => {
	const count = await payload.count({ collection: 'offers' })
	if (count.totalDocs === 0) {
		for (const entry of SEED_OFFERS) {
			await payload.create({
				collection: 'offers',
				data: {
					title: entry.title,
					slug: entry.slug,
					tenant: tenants[entry.tenantKey].id,
					createdAt: seededCreatedAt(),
				},
				user: platformAdmin,
			})
		}
		payload.logger.info(`Seeded offers: ${SEED_OFFERS.map((o) => o.slug).join(', ')}`)
	}
	const signedRefOf = async (tenant: Tenant): Promise<string | undefined> => {
		const { docs } = await payload.find({
			collection: 'offers',
			where: { tenant: { equals: tenant.id } },
			limit: 1,
			depth: 0,
		})
		return signItemRef(payload, 'offers', docs[0]?.id)
	}
	return { alpha: await signedRefOf(tenants.alpha), beta: await signedRefOf(tenants.beta) }
}

/** Every seeded collection goal is worth the same fixed amount, so revenue is checkable. */
const GOAL_VALUE = 10

interface SeedGoalPage {
	goal: { slug: string; name: string }
	page: { title: string; slug: string; heading: string; label: string }
}

/** The unscoped install's editor-managed goal and the page whose CTA block points at it. */
const SEED_GOAL_PAGE: SeedGoalPage = {
	goal: { slug: 'newsletter', name: 'Newsletter signup' },
	page: {
		title: 'Newsletter',
		slug: 'newsletter',
		heading: 'Stay in the loop',
		label: 'Subscribe',
	},
}

/**
 * One goal per tenant, each on its own page, so a click on alpha's CTA is a conversion for
 * alpha and nothing at all for beta: the same isolation the providers seed demonstrates, on
 * the goals surface.
 */
const SEED_TENANT_GOAL_PAGES: Array<SeedGoalPage & { tenantKey: TenantKey }> = [
	{
		tenantKey: 'alpha',
		goal: { slug: 'alpha-newsletter', name: 'Alpha newsletter signup' },
		page: {
			title: 'Alpha offer',
			slug: 'alpha-offer',
			heading: 'Alpha: stay in the loop',
			label: 'Subscribe',
		},
	},
	{
		tenantKey: 'beta',
		goal: { slug: 'beta-quote', name: 'Beta quote request' },
		page: {
			title: 'Beta offer',
			slug: 'beta-offer',
			heading: 'Beta: tell us what you need',
			label: 'Request a quote',
		},
	},
]

/**
 * A goal document and its CTA page, each created once by slug. The scope goes under the field
 * `goals.collection.scopeField` names; created as the platform admin, for the reason
 * {@link seedTenantProviders} gives.
 */
const seedGoalPage = async (
	payload: Payload,
	entry: SeedGoalPage,
	opts: {
		platformAdmin: User
		scope?: { field: string; value: string }
	}
): Promise<void> => {
	const { platformAdmin, scope } = opts
	const existingGoal = await payload.count({
		collection: GOALS_SLUG,
		where: { slug: { equals: entry.goal.slug } },
	})
	if (existingGoal.totalDocs === 0) {
		await payload.create({
			collection: GOALS_SLUG,
			data: {
				name: entry.goal.name,
				slug: entry.goal.slug,
				enabled: true,
				match: { kind: 'goal' },
				value: { fixed: GOAL_VALUE },
				currency: DEV_REPORTING_CURRENCY,
				...(scope ? { [scope.field]: scope.value } : {}),
			},
			overrideAccess: true,
			user: platformAdmin,
		})
		payload.logger.info(`Seeded collection goal: ${entry.goal.slug}`)
	}

	const existingPage = await payload.count({
		collection: 'pages',
		where: { slug: { equals: entry.page.slug } },
	})
	if (existingPage.totalDocs === 0) {
		await payload.create({
			collection: 'pages',
			data: {
				title: entry.page.title,
				slug: entry.page.slug,
				createdAt: seededCreatedAt(),
				layout: [
					{
						blockType: 'cta',
						heading: entry.page.heading,
						label: entry.page.label,
						goal: entry.goal.slug,
					},
				],
			},
		})
		payload.logger.info(`Seeded CTA page: /${entry.page.slug}`)
	}
}

/** The path a goal's CTA page is served at. */
const goalPathOf = (entry: SeedGoalPage): { slug: string; path: string } => {
	const path = pagePath(entry.page)
	if (!path) {
		throw new Error(`analytics dev seed: goal page "${entry.goal.slug}" has no path`)
	}
	return { slug: entry.goal.slug, path }
}

const tenantGoal = (tenantKey: TenantKey): SeedGoalPage => {
	const entry = SEED_TENANT_GOAL_PAGES.find((e) => e.tenantKey === tenantKey)
	if (!entry) {
		throw new Error(`analytics dev seed: no goal page for tenant "${tenantKey}"`)
	}
	return entry
}

/** The reporting zone the install resolves for a scope, which its days are counted in. */
const zoneOf = async (payload: Payload, req: PayloadRequest, scope: string): Promise<string> => {
	const runtime = getRuntime(payload)
	return runtime ? resolveTimezoneFor(runtime, req, scope || null) : DEV_REPORTING_TIMEZONE
}

/** What tenancy mode seeds before its traffic: the tenants, and each one's signed offer ref. */
interface TenancySeed {
	tenants: SeededTenants
	offers: Partial<Record<TenantKey, string>>
}

/**
 * The sites the seed fills: the single install's own, or in tenancy mode alpha (about three times
 * beta's volume, mostly American), beta (mostly German-speaking) and a small platform site under
 * the null scope, each on its own host and in its own zone, each converting its own goal.
 */
const sitesOf = async (payload: Payload, tenancy?: TenancySeed): Promise<SiteProfile[]> => {
	const req = await createLocalReq({}, payload)
	if (!tenancy) {
		return [
			{
				key: 'site',
				hostname: 'localhost',
				tz: await zoneOf(payload, req, ''),
				visitsPerDay: 150,
				regulars: 40,
				goal: goalPathOf(SEED_GOAL_PAGE),
			},
		]
	}
	const { tenants, offers } = tenancy
	const alpha = String(tenants.alpha.id)
	const beta = String(tenants.beta.id)
	return [
		{
			key: 'platform',
			scope: '',
			hostname: 'localhost',
			tz: await zoneOf(payload, req, ''),
			visitsPerDay: 20,
			regulars: 6,
		},
		{
			key: 'alpha',
			scope: alpha,
			hostname: 'alpha.localhost',
			tz: await zoneOf(payload, req, alpha),
			visitsPerDay: 140,
			regulars: 36,
			countryBoost: { US: 2.2, CA: 1.5 },
			goal: goalPathOf(tenantGoal('alpha')),
			...(offers.alpha ? { offer: offers.alpha, offerGoal: OFFER_GOAL } : {}),
		},
		{
			key: 'beta',
			scope: beta,
			hostname: 'beta.localhost',
			tz: await zoneOf(payload, req, beta),
			visitsPerDay: 50,
			regulars: 14,
			countryBoost: { DE: 2.5, CH: 2, PL: 1.5 },
			goal: goalPathOf(tenantGoal('beta')),
			...(offers.beta ? { offer: offers.beta, offerGoal: OFFER_GOAL } : {}),
		},
	]
}

/**
 * Seeds the dev app: an admin, the pages the traffic visits, an editor-managed goal with its CTA
 * page, nine weeks of native traffic with every closed day counted, and one sync pass. Tenancy
 * mode adds tenants, a tenant admin, providers, an offer and a goal page per tenant. Idempotent:
 * documents are created once, and traffic only adds what is missing.
 */
export const seedDev = async (
	payload: Payload,
	opts: { tenancy?: boolean } = {}
): Promise<void> => {
	const { tenancy = false } = opts

	const existingDevAdmin = (
		await payload.find({
			collection: 'users',
			where: { email: { equals: DEV_ADMIN_EMAIL } },
			limit: 1,
		})
	).docs[0]
	const platformAdmin =
		existingDevAdmin ??
		(await payload.create({
			collection: 'users',
			data: { email: DEV_ADMIN_EMAIL, password: DEV_PASSWORD },
		}))
	if (!existingDevAdmin) {
		payload.logger.info(`Seeded dev admin: ${DEV_ADMIN_EMAIL} / ${DEV_PASSWORD}`)
	}

	const pageCount = await payload.count({ collection: 'pages' })
	if (pageCount.totalDocs === 0) {
		for (const page of SEED_PAGES) {
			await payload.create({ collection: 'pages', data: { ...page, createdAt: seededCreatedAt() } })
		}
		payload.logger.info(`Seeded ${SEED_PAGES.length} pages matching the traffic paths`)
	}

	let scoped: TenancySeed | undefined
	if (tenancy) {
		const tenants = await seedTenants(payload)
		await seedTenantUsers(payload, tenants)
		await seedTenantProviders(payload, tenants, platformAdmin)
		const offers = await seedTenantOffers(payload, tenants, platformAdmin)
		for (const entry of SEED_TENANT_GOAL_PAGES) {
			await seedGoalPage(payload, entry, {
				platformAdmin,
				scope: { field: TENANT_SCOPE_FIELD, value: String(tenants[entry.tenantKey].id) },
			})
		}
		scoped = { tenants, offers }
	} else {
		await seedGoalPage(payload, SEED_GOAL_PAGE, { platformAdmin })
	}

	const traffic = await seedTraffic(payload, await sitesOf(payload, scoped))
	payload.logger.info(
		`Seeded ${traffic.hits} analytics hits in ${traffic.storeMs} ms and counted ${traffic.days} day${traffic.days === 1 ? '' : 's'} in ${traffic.countMs} ms`
	)

	const dailyCount = await payload.count({ collection: 'analytics-daily' })
	if (dailyCount.totalDocs === 0) {
		const task = syncTask({
			schedule: DEFAULT_JOBS.sync,
			lookbackDays: 14,
			collectionSlug: 'analytics-daily',
			scopes: tenancy ? tenancyScopes : undefined,
		})
		const handler = task.handler
		if (typeof handler === 'function') {
			const req = await createLocalReq({}, payload)
			// The sync handler reads `req` alone; a job and its task helpers exist only in a queued run.
			await handler({ req } as unknown as Parameters<typeof handler>[0])
			payload.logger.info('Seeded analytics-daily via one sync pass')
		}
	}
}
