import { toHit } from '../../src/native/engine/toHit'
import type { BrowserName, OsName } from '../../src/native/ingest/browser'
import type { DeviceType } from '../../src/native/ingest/device'
import type { NormalizedEvent } from '../../src/native/ingest/normalizeEvent'
import { dailyVisitorId } from '../../src/native/ingest/visitorHash'
import { createUlidFactory } from '../../src/native/store/ids'
import type { HitRow } from '../../src/native/store/types'
import { type CalendarDay, calendarDayStart } from '../../src/timeframe/calendar'
import { seededRandom } from './hitFixtures'

const MINUTE = 60_000

const ids = createUlidFactory()

type Landing = Pick<
	NormalizedEvent,
	'referrer' | 'referrerHost' | 'utmSource' | 'utmMedium' | 'utmCampaign' | 'utmContent' | 'utmTerm'
>

const LANDINGS: readonly Landing[] = [
	{ referrer: 'https://www.google.com/', referrerHost: 'google.com' },
	{ referrer: 'https://news.example/story', referrerHost: 'news.example' },
	{
		referrer: 'https://mail.example/',
		referrerHost: 'mail.example',
		utmSource: 'newsletter',
		utmMedium: 'email',
		utmCampaign: 'fall',
		utmContent: 'hero',
		utmTerm: 'boots',
	},
	{},
]

const PLACES: ReadonlyArray<Pick<NormalizedEvent, 'country' | 'region' | 'city' | 'language'>> = [
	{ country: 'DE', region: 'BE', city: 'Berlin', language: 'de-de' },
	{ country: 'US', region: 'NY', city: 'New York', language: 'en-us' },
	{ country: 'FR', language: 'fr' },
]

const DEVICES: ReadonlyArray<{ device: DeviceType; browser: BrowserName; os: OsName }> = [
	{ device: 'desktop', browser: 'chrome', os: 'macos' },
	{ device: 'mobile', browser: 'safari', os: 'ios' },
	{ device: 'tablet', browser: 'firefox', os: 'android' },
]

export const PAGES = ['/', '/pricing', '/blog/a', '/blog/b_c', '/sale_50%', '/über']
export const ITEMS = ['offers:1', 'offers:2']

export interface SiteDay {
	scope: string
	day: CalendarDay
	/** The scope's zone: the visitor ids change at its midnight, as its daily salt does. */
	tz: string
	people?: number
	/** What has not happened yet today: nothing at or after it is kept. */
	until?: Date
}

const seedOf = (text: string): number => {
	let hash = 2166136261
	for (const char of text) {
		hash = Math.imul(hash ^ (char.codePointAt(0) ?? 0), 16777619)
	}
	return hash >>> 0
}

/**
 * A local day of a scope's visits, normalized events stored through `toHit`: ids salted per
 * local day, every kind of landing, reopened visits, items, goals, orders, engagements, a webhook.
 */
export const siteDay = (args: SiteDay): HitRow[] => {
	const { scope, day, tz } = args
	const random = seededRandom(seedOf(`${scope}:${day}:${args.people ?? 6}`))
	const pick = <T>(items: readonly T[]): T => {
		const item = items[Math.floor(random() * items.length)]
		if (item === undefined) {
			throw new Error('picked from nothing')
		}
		return item
	}
	const start = calendarDayStart(day, tz).getTime()
	const hits: HitRow[] = []
	const store = (event: NormalizedEvent, receivedAt: Date = event.timestamp): void => {
		if (args.until && (event.timestamp >= args.until || receivedAt > args.until)) {
			return
		}
		hits.push(toHit(event, { receivedAt, ids }))
	}
	for (const site of ['a', 'b']) {
		const hostname = `${site}.${scope}.example`
		for (let person = 0; person < (args.people ?? 6); person++) {
			const visitorId = dailyVisitorId({
				ip: `10.0.${person}.1`,
				ua: `agent-${person}`,
				site: hostname,
				salt: `salt:${day}`,
			})
			const who = { ...pick(PLACES), ...pick(DEVICES) }
			const event = (offset: number, over: Partial<NormalizedEvent>): NormalizedEvent => ({
				timestamp: new Date(start + offset * MINUTE),
				type: 'pageview',
				path: pick(PAGES),
				hostname,
				visitorId,
				scope,
				...who,
				...over,
			})
			const internal = { referrer: `https://${hostname}/` }
			// Visits start inside the first 19 hours, so even a 23-hour day holds all of them.
			let clock = 20 + ((person * 97 + (site === 'b' ? 35 : 0)) % 1100)
			for (let visit = 0; visit < 1 + (person % 3 === 0 ? 1 : 0) + (person % 2); visit++) {
				const steps = 1 + Math.floor(random() * 4)
				for (let step = 0; step < steps; step++) {
					const roll = random()
					if (step === 0) {
						store(
							event(clock, {
								...(visit === 0 ? pick(LANDINGS) : internal),
								...(random() < 0.5 ? { scrollDepth: 0 } : {}),
							})
						)
					} else if (roll < 0.35) {
						store(event(clock, internal))
					} else if (roll < 0.55) {
						const name = pick(['signup', 'item_click'])
						store(
							event(clock, {
								...internal,
								type: 'event',
								name,
								...(name === 'item_click' ? { item: pick(ITEMS) } : {}),
							})
						)
					} else if (roll < 0.7) {
						const value = pick([10, 20, 35])
						store(
							event(clock, {
								...internal,
								type: 'goal',
								name: 'purchase',
								path: '/checkout',
								value,
								currency: pick(['EUR', 'USD']),
								goals: [{ slug: 'purchase', value }],
								...(random() < 0.5 ? { item: pick(ITEMS) } : {}),
								...(random() < 0.3
									? { dedupeKey: `s.${scope}.${day}.${site}.${person}.${visit}.${step}` }
									: {}),
							})
						)
					} else {
						const at = event(clock, {
							...internal,
							type: 'engagement',
							durationMs: (1 + Math.floor(random() * 90)) * 1000,
							...(random() < 0.6 ? { scrollDepth: 10 + Math.floor(random() * 80) } : {}),
							...(random() < 0.6 ? { impressions: [pick(ITEMS)] } : {}),
						})
						store(at, new Date(at.timestamp.getTime() + 2 * MINUTE))
					}
					clock += 3
				}
				clock += 41
			}
		}
	}
	store({
		timestamp: new Date(start + 13 * 60 * MINUTE),
		type: 'goal',
		name: 'purchase',
		path: '/api/webhook',
		hostname: `a.${scope}.example`,
		visitorId: '',
		server: true,
		scope,
		value: 50,
		currency: 'EUR',
		goals: [{ slug: 'purchase', value: 50 }],
	})
	return hits
}

/**
 * `views(index)` pageviews of each of `pages` pages, each by its own visitor: more values than a
 * ranking's limit plus fifty candidates.
 */
export const pagesDay = (args: {
	scope: string
	day: CalendarDay
	tz: string
	pages: number
	views: (index: number) => number
	until?: Date
}): HitRow[] => {
	const start = calendarDayStart(args.day, args.tz).getTime()
	const hits: HitRow[] = []
	for (let index = 0; index < args.pages; index++) {
		for (let view = 0; view < args.views(index); view++) {
			const timestamp = new Date(start + (index + view) * MINUTE)
			if (args.until && timestamp >= args.until) {
				continue
			}
			hits.push(
				toHit(
					{
						timestamp,
						type: 'pageview',
						path: `/page-${String(index).padStart(2, '0')}`,
						hostname: `${args.scope}.example`,
						visitorId: dailyVisitorId({
							ip: `10.1.${index}.${view}`,
							ua: 'ranker',
							site: args.scope,
							salt: `salt:${args.day}`,
						}),
						scope: args.scope,
					},
					{ receivedAt: timestamp, ids }
				)
			)
		}
	}
	return hits
}
