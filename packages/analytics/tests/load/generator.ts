import { toHit } from '../../src/native/engine/toHit'
import type { NormalizedEvent } from '../../src/native/ingest/normalizeEvent'
import { dedupeKeyFor, type IngestOrigin } from '../../src/native/ingest/revenue'
import { createUlidFactory } from '../../src/native/store/ids'
import type { HitRow } from '../../src/native/store/types'
import { seededRandom } from '../int/hitFixtures'

const MINUTE = 60_000
const DAY = 86_400_000

type Random = () => number

/** Draws ranks 0..n-1 with probability proportional to 1 / (rank + 1)^s. */
export const zipf = (n: number, s: number, random: Random): (() => number) => {
	const cdf = new Float64Array(n)
	let total = 0
	for (let rank = 0; rank < n; rank++) {
		total += 1 / (rank + 1) ** s
		cdf[rank] = total
	}
	return () => {
		const target = random() * total
		let low = 0
		let high = n - 1
		while (low < high) {
			const middle = (low + high) >>> 1
			if ((cdf[middle] ?? 0) < target) {
				low = middle + 1
			} else {
				high = middle
			}
		}
		return low
	}
}

const pickOf = <T>(items: readonly T[], random: Random): T => {
	const item = items[Math.floor(random() * items.length)]
	if (item === undefined) {
		throw new Error('picked from nothing')
	}
	return item
}

/** The share of each hour of the day's visits that start in it, midnight first. */
const HOUR_WEIGHTS = [
	1, 0.6, 0.4, 0.3, 0.3, 0.5, 1, 2, 3.5, 4.5, 5, 5, 4.6, 4.4, 4.6, 4.8, 4.6, 4.2, 4, 4.2, 4.4, 3.8,
	2.8, 1.8,
]
const HOUR_TOTAL = HOUR_WEIGHTS.reduce((sum, weight) => sum + weight, 0)

const hourOf = (random: Random): number => {
	let left = random() * HOUR_TOTAL
	for (let hour = 0; hour < HOUR_WEIGHTS.length; hour++) {
		left -= HOUR_WEIGHTS[hour] ?? 0
		if (left < 0) {
			return hour
		}
	}
	return 23
}

const DEVICES = [
	{ device: 'desktop', browser: 'chrome', os: 'macos' },
	{ device: 'desktop', browser: 'chrome', os: 'windows' },
	{ device: 'mobile', browser: 'safari', os: 'ios' },
	{ device: 'mobile', browser: 'chrome', os: 'android' },
	{ device: 'desktop', browser: 'edge', os: 'windows' },
	{ device: 'desktop', browser: 'firefox', os: 'windows' },
	{ device: 'desktop', browser: 'safari', os: 'macos' },
	{ device: 'tablet', browser: 'safari', os: 'ios' },
	{ device: 'mobile', browser: 'samsung', os: 'android' },
	{ device: 'desktop', browser: 'firefox', os: 'linux' },
] as const satisfies ReadonlyArray<Pick<NormalizedEvent, 'device' | 'browser' | 'os'>>

/** Where a visitor is, which a synthetic visitor keeps all day. */
type Place = Pick<NormalizedEvent, 'country' | 'region' | 'city' | 'language'>

const SEARCH = ['google.com', 'bing.com', 'duckduckgo.com', 'ecosia.org', 'yahoo.com']
const SOCIAL = ['t.co', 'reddit.com', 'linkedin.com', 'facebook.com', 'youtube.com']
const MEDIUMS = ['email', 'cpc', 'paid-social', 'affiliate', 'display', 'social']
const EVENTS = 30
const COUNTRIES = 60
const CITIES_PER_COUNTRY = 40

/** What a synthetic site has: how many distinct values each of its long tails runs to. */
export interface SyntheticSite {
	scope: string
	hostname: string
	/** Distinct paths, read with a Zipf skew: a few pages take most views. */
	pages: number
	/** Distinct referring hosts beyond the search engines and social networks. */
	referrers: number
	campaigns: number
	/** Content items seen and clicked on its pages. */
	items: number
}

export const DEFAULT_SITE: Omit<SyntheticSite, 'scope' | 'hostname'> = {
	pages: 3000,
	referrers: 1500,
	campaigns: 200,
	items: 500,
}

/** A day's hits, `size` at a time, in the order a day's visits produce them. */
export interface DayHits {
	site: SyntheticSite
	/** The day's first instant. */
	start: Date
	/** How many hits the day's visits make. */
	hits: number
	seed: number
	/** Hits per chunk handed back. Default 5,000. */
	chunk?: number
	/** How much of the day from `start` visits begin in, in ms: a day still running. Default a day. */
	span?: number
	/** Nothing at or after this instant is kept: what a day still running has not seen yet. */
	until?: Date
	/**
	 * Purchases as orders keyed like the tracker's (`ow.`), plus `server` share also recorded server
	 * side (`os.`, a visitorless hit); `key` is the `orderDigestKey` ingest digests orders with.
	 */
	orders?: { server: number; key?: Buffer }
}

/**
 * One day of Zipf-skewed visits as `toHit` rows; as under a daily salt, a visitor id is new each
 * day and keeps one place and device. Chunked, so a 670,000-hit day never sits in memory whole.
 */
export function* dayHits(args: DayHits): Generator<HitRow[]> {
	const { site, start, seed } = args
	const size = args.chunk ?? 5000
	const random = seededRandom(seed)
	const page = zipf(site.pages, 1.1, random)
	const referrer = zipf(site.referrers, 1.2, random)
	const campaign = zipf(site.campaigns, 1.1, random)
	const country = zipf(COUNTRIES, 1.3, random)
	const city = zipf(CITIES_PER_COUNTRY, 1.2, random)
	const item = zipf(site.items, 1.0, random)
	const event = zipf(EVENTS, 1.2, random)
	const ids = createUlidFactory()
	const people = Math.max(50, Math.round(args.hits / 9))
	const span = args.span ?? DAY
	const dayTag = start.toISOString().slice(0, 10).replaceAll('-', '')
	const known = new Map<number, Pick<NormalizedEvent, 'device' | 'browser' | 'os'> & Place>()
	let chunk: HitRow[] = []
	let planned = 0
	const keep = (event: NormalizedEvent, receivedAt: Date = event.timestamp): HitRow[] | null => {
		if (planned >= args.hits) {
			return null
		}
		planned += 1
		if (args.until && (event.timestamp >= args.until || receivedAt > args.until)) {
			return null
		}
		chunk.push(toHit(event, { receivedAt, ids }))
		if (chunk.length < size) {
			return null
		}
		const full = chunk
		chunk = []
		return full
	}
	while (planned < args.hits) {
		const person = Math.floor(random() * people)
		const visitorId = `${dayTag}${String(person).padStart(8, '0')}`
		let held = known.get(person)
		if (!held) {
			const countryRank = country()
			held = {
				...pickOf(DEVICES, random),
				country: `C${countryRank}`,
				region: `C${countryRank}R${city() % 8}`,
				city: `C${countryRank}City${city()}`,
				language: `l${countryRank % 30}`,
			}
			known.set(person, held)
		}
		const roll = random()
		const host =
			roll < 0.6
				? pickOf(SEARCH, random)
				: roll < 0.7
					? pickOf(SOCIAL, random)
					: `ref${referrer()}.example`
		const arrival: Partial<NormalizedEvent> =
			roll < 0.3
				? {}
				: roll < 0.85
					? { referrer: `https://${host}/`, referrerHost: host }
					: {
							utmSource: `source${campaign() % 40}`,
							utmMedium: pickOf(MEDIUMS, random),
							utmCampaign: `campaign${campaign()}`,
							...(random() < 0.3 ? { utmContent: `content${campaign() % 20}` } : {}),
							...(random() < 0.2 ? { utmTerm: `term${campaign() % 50}` } : {}),
						}
		const share = (hourOf(random) + random()) / 24
		let clock = start.getTime() + Math.floor(share * Math.max(0, span - 10 * MINUTE))
		const base = {
			hostname: site.hostname,
			scope: site.scope,
			visitorId,
			...held,
		}
		const pageviews = Math.min(12, 1 + Math.floor(Math.log(random()) / Math.log(0.55)))
		const seen: string[] = []
		for (let step = 0; step < pageviews && planned < args.hits; step++) {
			const path = `/p/${page()}`
			const flushed = keep({
				...base,
				...(step === 0 ? arrival : { navigation: true, referrer: `https://${site.hostname}/` }),
				timestamp: new Date(clock),
				type: 'pageview',
				path,
				scrollDepth: 0,
			})
			if (flushed) yield flushed
			const dwell = 5_000 + Math.floor(random() * 120_000)
			if (random() < 0.8) {
				const impressions =
					random() < 0.25
						? Array.from({ length: 1 + Math.floor(random() * 4) }, () => `items:${item()}`)
						: []
				seen.push(...impressions)
				const engaged = keep(
					{
						...base,
						timestamp: new Date(clock),
						type: 'engagement',
						path,
						durationMs: Math.floor(dwell * 0.8),
						scrollDepth: Math.floor(random() * 100),
						...(impressions.length > 0 ? { impressions } : {}),
					},
					new Date(clock + dwell)
				)
				if (engaged) yield engaged
			}
			clock += dwell + 2_000
		}
		if (random() < 0.12 && planned < args.hits) {
			const clicked = seen.length > 0 && random() < 0.4 ? pickOf(seen, random) : undefined
			const flushed = keep({
				...base,
				timestamp: new Date(clock),
				type: 'event',
				name: clicked ? 'item_click' : `event${event()}`,
				path: `/p/${page()}`,
				...(clicked ? { item: clicked } : {}),
			})
			if (flushed) yield flushed
		}
		if (random() < 0.025 && planned < args.hits) {
			const value = 10 + Math.floor(random() * 190)
			const slug = random() < 0.5 ? 'purchase' : 'signup'
			const goals = [{ slug, value: slug === 'purchase' ? value : 0 }]
			const order = args.orders && slug === 'purchase' ? `${visitorId}-${planned}` : undefined
			const keyOf = (origin: IngestOrigin): string | undefined =>
				order === undefined
					? undefined
					: dedupeKeyFor({
							origin,
							tenant: site.scope,
							goal: slug,
							orderId: order,
							...(args.orders?.key ? { key: args.orders.key } : {}),
						})
			const flushed = keep({
				...base,
				timestamp: new Date(clock + 1_000),
				type: 'goal',
				name: slug,
				path: '/checkout',
				value,
				currency: 'EUR',
				goals,
				dedupeKey: keyOf('wire'),
			})
			if (flushed) yield flushed
			if (order !== undefined && random() < (args.orders?.server ?? 0)) {
				const recorded = keep({
					hostname: site.hostname,
					scope: site.scope,
					visitorId: '',
					server: true,
					timestamp: new Date(clock + 30_000),
					type: 'goal',
					name: slug,
					path: '/orders',
					value,
					currency: 'EUR',
					goals,
					dedupeKey: keyOf('server'),
				})
				if (recorded) yield recorded
			}
		}
	}
	if (chunk.length > 0) {
		yield chunk
	}
}

/** One beacon as the tracker posts it, with the headers a browser and the proxy in front add. */
export interface Beacon {
	body: Record<string, unknown>
	headers: Record<string, string>
}

const AGENTS = [
	'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36',
	'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1',
	'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36',
	'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Mobile Safari/537.36',
	'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:131.0) Gecko/20100101 Firefox/131.0',
]

/**
 * `count` beacons spread over `hosts` (one scope each): pageviews with a referrer or a campaign
 * on the first page of a visit, an engagement after most pageviews, and an event now and then.
 */
export const beacons = (args: {
	count: number
	hosts: readonly string[]
	seed: number
	pages?: number
}): Beacon[] => {
	const random = seededRandom(args.seed)
	const page = zipf(args.pages ?? 3000, 1.1, random)
	const out: Beacon[] = []
	while (out.length < args.count) {
		const host = pickOf(args.hosts, random)
		const person = Math.floor(random() * 50_000)
		const headers = {
			'content-type': 'text/plain;charset=UTF-8',
			host,
			'user-agent': pickOf(AGENTS, random),
			'accept-language': 'en-US,en;q=0.9',
			'x-forwarded-for': `10.${person >> 16}.${(person >> 8) & 255}.${person & 255}`,
			'sec-fetch-site': 'same-origin',
		}
		const views = Math.min(6, 1 + Math.floor(Math.log(random()) / Math.log(0.55)))
		for (let view = 0; view < views && out.length < args.count; view++) {
			const path = `/p/${page()}`
			out.push({
				headers,
				body: {
					type: 'pageview',
					path,
					...(view === 0
						? random() < 0.3
							? { query: 'utm_source=newsletter&utm_medium=email&utm_campaign=load' }
							: { referrer: 'https://www.google.com/' }
						: { referrer: `https://${host}/`, nav: 1 }),
				},
			})
			if (random() < 0.8 && out.length < args.count) {
				out.push({
					headers,
					body: { type: 'engagement', path, durationMs: 20_000, scrollDepth: 60, sinceMs: 20_000 },
				})
			}
		}
		if (random() < 0.1 && out.length < args.count) {
			out.push({ headers, body: { type: 'event', name: 'signup', path: '/p/0' } })
		}
	}
	return out
}
