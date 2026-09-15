import type { Payload, PayloadRequest } from 'payload'
import { GOALS_SLUG } from '../../src/goals/collection'
import { EVENTS_SLUG } from '../../src/native/collections/events'
import { flushBatch } from '../../src/native/ingest/flushBatch'
import type { StoredEvent } from '../../src/native/ingest/normalizeEvent'
import { syncTask } from '../../src/sync/syncTask'
import { startOfDayInTz } from '../../src/timeframe/tz'
import { DEV_REPORTING_TIMEZONE, pagePath } from '../config/shared'
import { GOAL_SCOPE_FIELD, tenancyScopes } from '../config/tenancy'
import { devMemoryAdapter } from './adapters'

const DEV_EMAIL = 'dev@10xmedia.de'
const DEV_PASSWORD = 'password'
const ALPHA_EMAIL = 'alpha@10xmedia.de'
const BETA_EMAIL = 'beta@10xmedia.de'

const SEED_PATHS = ['/', '/about', '/pricing', '/blog', '/contact']
const SEED_COUNTRIES = ['US', 'DE', 'GB', 'FR']
const SEED_DEVICES = ['desktop', 'mobile', 'tablet'] as const
const SEED_SOURCES = ['google.com', 'Direct', 't.co', 'news.ycombinator.com']
const SEED_VISITOR_COUNT = 6
const DAY_MS = 24 * 60 * 60 * 1000

/** Named custom events, so the events breakdown widget has rows on a fresh boot. */
const SEED_EVENT_NAMES = ['signup', 'download', 'video-play']

/**
 * One conversion every third dense day, so the goals widget shows a table on a fresh boot and
 * every preset compares against a previous window that also converted.
 */
const CONVERSION_EVERY_DAYS = 3

/**
 * Two years, so every preset compares against a populated previous window and the widgets
 * always show a real percentage: `lastYear` looks back 365 days and compares against the
 * 365 before that. (`allTime` is the one preset with no previous window by definition, and
 * omits its comparison.)
 */
const SEED_DAYS = 730

/** The recent span carrying realistic day-to-day traffic and the dimension breakdowns. */
const SEED_DENSE_DAYS = 180

/** Tenancy mode: alpha runs roughly 3x beta's volume so the isolation is visually obvious. */
const ALPHA_SCALE = 3
const BETA_SCALE = 1

/**
 * Traffic decays with age and wobbles day to day, so each window is measurably busier than
 * the one before it and no comparison lands on a flat 0%. Beyond the dense span the seed
 * thins to an occasional pageview: enough to give the year-long presets a real baseline
 * without paying for two years of daily rollups on every dev boot. Deterministic: the same
 * `day` always yields the same count.
 */
const pageviewsForDay = (day: number): number =>
	day < SEED_DENSE_DAYS
		? Math.max(1, Math.round(6 * Math.exp(-day / 90) * (1 + 0.3 * Math.sin(day * 1.7))))
		: day % 3 === 0
			? 1
			: 0

/**
 * Builds a deterministic span of pageview events, plus the named custom events and goal
 * completions the events and goals surfaces read. `scale` multiplies the daily pageview
 * volume (alpha and beta get different scales in tenancy mode); `scope` stamps every event;
 * `goal` names the goal the seeded conversions complete (the install's own collection goal,
 * per tenant in tenancy mode) and the path they happen on, which is that goal's own CTA page
 * rather than the site root: `/` carries the conversions the e2e specs fire by hand, and one
 * of them asserts the other tenant's root has none. A scoped install has no scope-less bucket
 * family (rollups make `scope` required, '' = null scope), so omitting `scope` is only
 * correct for a genuinely unscoped install.
 *
 * Seeded events bypass the ingest endpoint, so goal matching never runs on them: a
 * conversion has to carry its completion explicitly, at the value the goal document states.
 */
const buildSeedEvents = (
	now: Date,
	opts: { scale?: number; scope?: string; goal?: { slug: string; path: string } } = {}
): StoredEvent[] => {
	const scale = opts.scale ?? 1
	const events: StoredEvent[] = []
	const scoped = opts.scope !== undefined ? { scope: opts.scope } : {}
	for (let day = 0; day < SEED_DAYS; day++) {
		const pageviewsToday = Math.max(0, Math.round(pageviewsForDay(day) * scale))
		for (let i = 0; i < pageviewsToday; i++) {
			// Pair consecutive pageviews onto one visitor (and drift the window across days)
			// so visitors stay realistically below pageviews rather than one-to-one.
			const visitorHash = `seed-visitor-${(day + Math.floor(i / 2)) % SEED_VISITOR_COUNT}`
			events.push({
				timestamp: new Date(now.getTime() - day * DAY_MS + i * 90_000),
				type: 'pageview',
				path: SEED_PATHS[(day + i) % SEED_PATHS.length] ?? '/',
				hostname: 'localhost',
				visitorHash,
				sessionId: `${visitorHash}-d${day}`,
				durationMs: 30_000 + ((day + i) % 5) * 30_000,
				country: SEED_COUNTRIES[(day + i) % SEED_COUNTRIES.length],
				device: SEED_DEVICES[(day + i) % SEED_DEVICES.length],
				source: SEED_SOURCES[(day + i) % SEED_SOURCES.length],
				timezone: DEV_REPORTING_TIMEZONE,
				...scoped,
			})
		}
		if (day >= SEED_DENSE_DAYS) {
			continue
		}
		const visitorHash = `seed-visitor-${day % SEED_VISITOR_COUNT}`
		const attribution = {
			hostname: 'localhost',
			visitorHash,
			sessionId: `${visitorHash}-d${day}`,
			country: SEED_COUNTRIES[day % SEED_COUNTRIES.length],
			device: SEED_DEVICES[day % SEED_DEVICES.length],
			source: SEED_SOURCES[day % SEED_SOURCES.length],
			timezone: DEV_REPORTING_TIMEZONE,
			...scoped,
		}
		events.push({
			timestamp: new Date(now.getTime() - day * DAY_MS + 60_000),
			type: 'event',
			name: SEED_EVENT_NAMES[day % SEED_EVENT_NAMES.length] ?? 'signup',
			path: SEED_PATHS[day % SEED_PATHS.length] ?? '/',
			...attribution,
		})
		if (opts.goal && day % CONVERSION_EVERY_DAYS === 0) {
			events.push({
				timestamp: new Date(now.getTime() - day * DAY_MS + 120_000),
				type: 'goal',
				name: opts.goal.slug,
				path: opts.goal.path,
				value: GOAL_VALUE,
				currency: GOAL_CURRENCY,
				goals: [{ slug: opts.goal.slug, value: GOAL_VALUE }],
				...attribution,
			})
		}
	}
	return events
}

/**
 * Flush the seed one rollup period at a time, several periods at once. Every rollup bucket
 * and seen-ledger row is keyed by the event's period (`bucketKey` includes it), so batches
 * from different periods touch disjoint rows and cannot race; only the per-batch work is
 * serial. Grouping must use the same timezone-aware day the rollups bucket on, not the UTC
 * day, or two events sharing a local day could land in different batches and race. Without
 * this the ledger's insert-if-new gate runs sequentially across the whole span and the boot
 * seed takes minutes.
 */
const flushSeedEvents = async (payload: Payload, events: StoredEvent[]): Promise<void> => {
	const byDay = new Map<string, StoredEvent[]>()
	for (const event of events) {
		const day = startOfDayInTz(event.timestamp, event.timezone).toISOString()
		const batch = byDay.get(day)
		if (batch) {
			batch.push(event)
		} else {
			byDay.set(day, [event])
		}
	}
	const batches = [...byDay.values()]
	// Past ~24 the in-memory mongo contends and the seed gets slower, not faster.
	const CONCURRENCY = 24
	for (let i = 0; i < batches.length; i += CONCURRENCY) {
		await Promise.all(batches.slice(i, i + CONCURRENCY).map((b) => flushBatch(payload, b)))
	}
}

const SEED_PAGES = [
	// `home` is the site root through `pagePath`, so the CTA's conversions have a document
	// to surface on.
	{ title: 'Home', slug: 'home' },
	{ title: 'About', slug: 'about' },
	{ title: 'Pricing', slug: 'pricing' },
	{ title: 'Blog', slug: 'blog' },
	{ title: 'Contact', slug: 'contact' },
]

/**
 * Mirror the native seed into the memory provider so multi-provider reads have data. The
 * provider counts pageviews only, so the seeded custom events and conversions stay out of it
 * rather than arriving there as extra pageviews.
 */
const seedMemoryAdapter = (events: StoredEvent[]): void => {
	for (const event of events) {
		if (event.type !== 'pageview') {
			continue
		}
		devMemoryAdapter.record({
			path: event.path,
			timestamp: event.timestamp,
			visitor: event.visitorHash,
		})
	}
}

interface TenantDoc {
	id: string | number
	slug: string
}

const SEED_TENANTS = [
	{ slug: 'alpha', name: 'Alpha' },
	{ slug: 'beta', name: 'Beta' },
] as const

/** Seeds the `tenants` collection, idempotent, and resolves the alpha/beta docs either way. */
const seedTenants = async (payload: Payload): Promise<{ alpha: TenantDoc; beta: TenantDoc }> => {
	const tenantCount = await payload.count({ collection: 'tenants' as never })
	if (tenantCount.totalDocs === 0) {
		for (const tenant of SEED_TENANTS) {
			await payload.create({
				collection: 'tenants' as never,
				data: { name: tenant.name, slug: tenant.slug } as never,
			})
		}
		payload.logger.info(`Seeded tenants: ${SEED_TENANTS.map((t) => t.slug).join(', ')}`)
	}
	const found = (await payload.find({ collection: 'tenants' as never, pagination: false }))
		.docs as unknown as TenantDoc[]
	const alpha = found.find((t) => t.slug === 'alpha')
	const beta = found.find((t) => t.slug === 'beta')
	if (!alpha || !beta) {
		throw new Error('analytics dev seed: alpha/beta tenants missing after seeding')
	}
	return { alpha, beta }
}

/** Assigns `alpha@`/`beta@` to their tenant via the multi-tenant plugin's `tenants` array field. */
const seedTenantUsers = async (
	payload: Payload,
	tenants: { alpha: TenantDoc; beta: TenantDoc }
): Promise<void> => {
	const assignments: Array<{ email: string; tenant: string | number }> = [
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
				data: { email, password: DEV_PASSWORD, tenants: [{ tenant }] } as never,
			})
			payload.logger.info(`Seeded tenant admin: ${email} / ${DEV_PASSWORD}`)
		}
	}
}

const SEED_PROVIDERS = [
	{ tenantKey: 'alpha', name: 'Alpha Plausible', siteId: 'alpha.example.com' },
	{ tenantKey: 'beta', name: 'Beta Plausible', siteId: 'beta.example.com' },
] as const

/**
 * One enabled placeholder Plausible provider per tenant, so the source picker and the
 * Analytics Providers admin view have something to show. Dummy credentials: reads through
 * this provider fail and degrade, which is fine for a demo of the provider surface itself.
 * Stamped as the platform admin (`dev@10xmedia.de`) so the stampScope hook accepts the
 * explicit `tenant` value instead of trying to resolve one from a (cookie-less) seed req.
 */
const seedTenantProviders = async (
	payload: Payload,
	tenants: { alpha: TenantDoc; beta: TenantDoc },
	platformAdmin: { id: string | number }
): Promise<void> => {
	const count = await payload.count({ collection: 'analytics-providers' as never })
	if (count.totalDocs > 0) {
		return
	}
	for (const { tenantKey, name, siteId } of SEED_PROVIDERS) {
		await payload.create({
			collection: 'analytics-providers' as never,
			data: {
				name,
				provider: 'plausible',
				enabled: true,
				tenant: tenants[tenantKey].id,
				plausible: { siteId, apiKey: 'dev-dummy-api-key' },
			} as never,
			user: platformAdmin as never,
		})
	}
	payload.logger.info(`Seeded analytics-providers: ${SEED_PROVIDERS.map((p) => p.name).join(', ')}`)
}

/** Every seeded collection goal is worth the same fixed amount, so revenue is checkable. */
const GOAL_VALUE = 10
const GOAL_CURRENCY = 'EUR'

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
const SEED_TENANT_GOAL_PAGES: Array<SeedGoalPage & { tenantKey: 'alpha' | 'beta' }> = [
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
 * A goal document and its CTA page, both guarded by slug so a re-boot against a populated
 * database adds neither twice. The scope is written under whatever field the install points
 * `scopeField` at (`GOAL_SCOPE_FIELD` for the tenancy fragment), never a hard-coded key:
 * writing `scope` to a collection scoped by a tenant plugin's own relationship field would
 * land every seeded goal install-wide instead. Stamped as the platform admin for the same
 * reason the provider seed is: the hook that stamps the scope only honours an explicit one
 * from a request it recognizes as platform-wide, and the seed carries no tenant cookie.
 */
const seedGoalPage = async (
	payload: Payload,
	entry: SeedGoalPage,
	opts: {
		platformAdmin: { id: string | number }
		scope?: { field: string; value: string | number }
	}
): Promise<void> => {
	const { platformAdmin, scope } = opts
	const existingGoal = await payload.count({
		collection: GOALS_SLUG as never,
		where: { slug: { equals: entry.goal.slug } },
	})
	if (existingGoal.totalDocs === 0) {
		await payload.create({
			collection: GOALS_SLUG as never,
			data: {
				name: entry.goal.name,
				slug: entry.goal.slug,
				enabled: true,
				match: { kind: 'goal' },
				value: { fixed: GOAL_VALUE },
				currency: GOAL_CURRENCY,
				...(scope ? { [scope.field]: scope.value } : {}),
			} as never,
			overrideAccess: true,
			user: platformAdmin as never,
		})
		payload.logger.info(`Seeded collection goal: ${entry.goal.slug}`)
	}

	const existingPage = await payload.count({
		collection: 'pages' as never,
		where: { slug: { equals: entry.page.slug } },
	})
	if (existingPage.totalDocs === 0) {
		await payload.create({
			collection: 'pages' as never,
			data: {
				title: entry.page.title,
				slug: entry.page.slug,
				layout: [
					{
						blockType: 'cta',
						heading: entry.page.heading,
						label: entry.page.label,
						goal: entry.goal.slug,
					},
				],
			} as never,
		})
		payload.logger.info(`Seeded CTA page: /${entry.page.slug}`)
	}
}

/**
 * Seed the dev Payload app: an admin user to log in with, page documents matching the
 * seeded traffic paths (so the per-document Analytics tab shows real numbers), a
 * two-year span of sample pageviews in both the native engine and the memory provider,
 * one sync pass so the analytics-daily collection has rows to inspect, and one
 * editor-managed goal with the CTA page that converts it. In tenancy mode, additionally
 * seeds the `tenants` collection, a tenant-scoped admin per tenant, a scaled-volume
 * traffic span per tenant, one placeholder provider doc per tenant, and one goal plus CTA
 * page per tenant instead of the unscoped pair.
 * Idempotent (each block is skipped once its collection is populated).
 */
export const seedDev = async (
	payload: Payload,
	opts: { tenancy?: boolean } = {}
): Promise<void> => {
	const { tenancy = false } = opts

	const existingDevAdmin = (
		await payload.find({ collection: 'users', where: { email: { equals: DEV_EMAIL } }, limit: 1 })
	).docs[0] as { id: string | number } | undefined
	const platformAdmin: { id: string | number } =
		existingDevAdmin ??
		((await payload.create({
			collection: 'users',
			data: { email: DEV_EMAIL, password: DEV_PASSWORD },
		})) as unknown as { id: string | number })
	if (!existingDevAdmin) {
		payload.logger.info(`Seeded dev admin: ${DEV_EMAIL} / ${DEV_PASSWORD}`)
	}

	const pageCount = await payload.count({ collection: 'pages' as never })
	if (pageCount.totalDocs === 0) {
		for (const page of SEED_PAGES) {
			await payload.create({ collection: 'pages' as never, data: page as never })
		}
		payload.logger.info(`Seeded ${SEED_PAGES.length} pages matching the traffic paths`)
	}

	const tenants = tenancy ? await seedTenants(payload) : undefined
	if (tenants) {
		await seedTenantUsers(payload, tenants)
	}

	// Each scope converts its own goal on that goal's own CTA page, so a tenant's goals
	// widget lists that tenant's goal and never the other one.
	const conversionsFor = (entry: SeedGoalPage): { slug: string; path: string } => {
		const path = pagePath(entry.page)
		if (!path) {
			throw new Error(`analytics dev seed: goal page "${entry.goal.slug}" has no path`)
		}
		return { slug: entry.goal.slug, path }
	}
	const tenantGoal = (tenantKey: 'alpha' | 'beta'): SeedGoalPage => {
		const entry = SEED_TENANT_GOAL_PAGES.find((e) => e.tenantKey === tenantKey)
		if (!entry) {
			throw new Error(`analytics dev seed: no goal page for tenant "${tenantKey}"`)
		}
		return entry
	}
	const events = [
		// Tenancy mode is a scoped install, so even the install-wide pass needs the
		// explicit null-scope stamp ('') rather than an absent scope key.
		...buildSeedEvents(
			new Date(),
			tenants ? { scope: '' } : { goal: conversionsFor(SEED_GOAL_PAGE) }
		),
		...(tenants
			? buildSeedEvents(new Date(), {
					scale: ALPHA_SCALE,
					scope: String(tenants.alpha.id),
					goal: conversionsFor(tenantGoal('alpha')),
				})
			: []),
		...(tenants
			? buildSeedEvents(new Date(), {
					scale: BETA_SCALE,
					scope: String(tenants.beta.id),
					goal: conversionsFor(tenantGoal('beta')),
				})
			: []),
	]
	seedMemoryAdapter(events)
	const eventCount = await payload.count({ collection: EVENTS_SLUG as never })
	if (eventCount.totalDocs === 0) {
		await flushSeedEvents(payload, events)
		payload.logger.info(`Seeded ${events.length} analytics events`)
	}

	if (tenants) {
		await seedTenantProviders(payload, tenants, platformAdmin)
		for (const entry of SEED_TENANT_GOAL_PAGES) {
			await seedGoalPage(payload, entry, {
				platformAdmin,
				scope: { field: GOAL_SCOPE_FIELD, value: String(tenants[entry.tenantKey].id) },
			})
		}
	} else {
		await seedGoalPage(payload, SEED_GOAL_PAGE, { platformAdmin })
	}

	const dailyCount = await payload.count({ collection: 'analytics-daily' as never })
	if (dailyCount.totalDocs === 0) {
		const task = syncTask({
			cron: '0 */6 * * *',
			lookbackDays: 14,
			collectionSlug: 'analytics-daily',
			scopes: tenancy ? tenancyScopes : undefined,
		})
		const handler = task.handler
		if (typeof handler === 'function') {
			const req = { payload } as unknown as PayloadRequest
			await handler({ req } as unknown as Parameters<typeof handler>[0])
			payload.logger.info('Seeded analytics-daily via one sync pass')
		}
	}
}
