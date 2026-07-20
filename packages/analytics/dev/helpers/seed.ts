import type { Payload, PayloadRequest } from 'payload'
import { EVENTS_SLUG } from '../../src/native/collections/events'
import { flushBatch } from '../../src/native/ingest/flushBatch'
import type { StoredEvent } from '../../src/native/ingest/normalizeEvent'
import { syncTask } from '../../src/sync/syncTask'
import { startOfDayInTz } from '../../src/timeframe/tz'
import { devMemoryAdapter } from './adapters'

const DEV_EMAIL = 'dev@10xmedia.de'
const DEV_PASSWORD = 'password'

/**
 * Shared with the plugin's `reportingTimezone` in `payload.config.ts`. Seeding bypasses
 * the ingest endpoint (no request to resolve a timezone from), so events carry the zone
 * explicitly; otherwise their rollups bucket on UTC days and a "Today" read aligned to
 * this zone misses them.
 */
export const DEV_REPORTING_TIMEZONE = 'America/New_York'

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

const buildSeedEvents = (now: Date): StoredEvent[] => {
	const events: StoredEvent[] = []
	for (let day = 0; day < SEED_DAYS; day++) {
		const pageviewsToday = pageviewsForDay(day)
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

/**
 * Seed the dev Payload app: an admin user to log in with, page documents matching the
 * seeded traffic paths (so the per-document Analytics tab shows real numbers), a
 * fortnight of sample pageviews in both the native engine and the memory provider,
 * and one sync pass so the analytics-daily collection has rows to inspect. Idempotent
 * (each block is skipped once its collection is populated).
 */
export const seedDev = async (payload: Payload): Promise<void> => {
	const userCount = await payload.count({ collection: 'users' })
	if (userCount.totalDocs === 0) {
		await payload.create({
			collection: 'users',
			data: { email: DEV_EMAIL, password: DEV_PASSWORD },
		})
		payload.logger.info(`Seeded dev admin: ${DEV_EMAIL} / ${DEV_PASSWORD}`)
	}

	const pageCount = await payload.count({ collection: 'pages' as never })
	if (pageCount.totalDocs === 0) {
		for (const page of SEED_PAGES) {
			await payload.create({ collection: 'pages' as never, data: page as never })
		}
		payload.logger.info(`Seeded ${SEED_PAGES.length} pages matching the traffic paths`)
	}

	const events = buildSeedEvents(new Date())
	seedMemoryAdapter(events)
	const eventCount = await payload.count({ collection: EVENTS_SLUG as never })
	if (eventCount.totalDocs === 0) {
		await flushSeedEvents(payload, events)
		payload.logger.info(`Seeded ${events.length} analytics pageview events`)
	}

	const dailyCount = await payload.count({ collection: 'analytics-daily' as never })
	if (dailyCount.totalDocs === 0) {
		const task = syncTask({
			cron: '0 */6 * * *',
			lookbackDays: 14,
			collectionSlug: 'analytics-daily',
		})
		const handler = task.handler
		if (typeof handler === 'function') {
			const req = { payload } as unknown as PayloadRequest
			await handler({ req } as unknown as Parameters<typeof handler>[0])
			payload.logger.info('Seeded analytics-daily via one sync pass')
		}
	}
}
