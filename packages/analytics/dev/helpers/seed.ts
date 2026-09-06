import type { Payload, PayloadRequest } from 'payload'
import { EVENTS_SLUG } from '../../src/native/collections/events'
import { flushBatch } from '../../src/native/ingest/flushBatch'
import type { StoredEvent } from '../../src/native/ingest/normalizeEvent'
import { syncTask } from '../../src/sync/syncTask'
import { startOfDayInTz } from '../../src/timeframe/tz'
import { DEV_REPORTING_TIMEZONE } from '../config/shared'
import { tenancyScopes } from '../config/tenancy'
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
 * Builds a deterministic span of pageview events. `scale` multiplies the daily volume
 * (alpha and beta get different scales in tenancy mode); `scope` stamps every event.
 * A scoped install has no scope-less bucket family (rollups make `scope` required,
 * '' = null scope), so omitting it is only correct for a genuinely unscoped install.
 */
const buildSeedEvents = (
	now: Date,
	opts: { scale?: number; scope?: string } = {}
): StoredEvent[] => {
	const scale = opts.scale ?? 1
	const events: StoredEvent[] = []
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
				...(opts.scope !== undefined ? { scope: opts.scope } : {}),
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
	{ title: 'About', slug: 'about' },
	{ title: 'Pricing', slug: 'pricing' },
	{ title: 'Blog', slug: 'blog' },
	{ title: 'Contact', slug: 'contact' },
]

/** Mirror the native seed into the memory provider so multi-provider reads have data. */
const seedMemoryAdapter = (events: StoredEvent[]): void => {
	for (const event of events) {
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

/**
 * Seed the dev Payload app: an admin user to log in with, page documents matching the
 * seeded traffic paths (so the per-document Analytics tab shows real numbers), a
 * two-year span of sample pageviews in both the native engine and the memory provider,
 * and one sync pass so the analytics-daily collection has rows to inspect. In tenancy
 * mode, additionally seeds the `tenants` collection, a tenant-scoped admin per tenant,
 * a scaled-volume traffic span per tenant, and one placeholder provider doc per tenant.
 * Idempotent (each block is skipped once its collection is populated).
 */
export const seedDev = async (
	payload: Payload,
	opts: { tenancy?: boolean } = {}
): Promise<void> => {
	const { tenancy = false } = opts

	const userCount = await payload.count({ collection: 'users' })
	if (userCount.totalDocs === 0) {
		await payload.create({
			collection: 'users',
			data: { email: DEV_EMAIL, password: DEV_PASSWORD },
		})
		payload.logger.info(`Seeded dev admin: ${DEV_EMAIL} / ${DEV_PASSWORD}`)
	}
	const platformAdmin = (
		await payload.find({ collection: 'users', where: { email: { equals: DEV_EMAIL } }, limit: 1 })
	).docs[0] as { id: string | number }

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

	const events = [
		// Tenancy mode is a scoped install, so even the install-wide pass needs the
		// explicit null-scope stamp ('') rather than an absent scope key.
		...buildSeedEvents(new Date(), tenants ? { scope: '' } : {}),
		...(tenants
			? buildSeedEvents(new Date(), { scale: ALPHA_SCALE, scope: String(tenants.alpha.id) })
			: []),
		...(tenants
			? buildSeedEvents(new Date(), { scale: BETA_SCALE, scope: String(tenants.beta.id) })
			: []),
	]
	seedMemoryAdapter(events)
	const eventCount = await payload.count({ collection: EVENTS_SLUG as never })
	if (eventCount.totalDocs === 0) {
		await flushSeedEvents(payload, events)
		payload.logger.info(`Seeded ${events.length} analytics pageview events`)
	}

	if (tenants) {
		await seedTenantProviders(payload, tenants, platformAdmin)
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
