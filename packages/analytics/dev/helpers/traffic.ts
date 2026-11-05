import { createHash } from 'node:crypto'
import { ITEM_CLICK_EVENT, PURCHASE_GOAL_SLUG } from '@10x-media/analytics'
import type { RawEventInput } from '../../src/native/ingest/normalizeEvent'
import {
	type CalendarDay,
	calendarDate,
	calendarDayOf,
	calendarDayStart,
} from '../../src/timeframe/calendar'

type Weighted<T> = ReadonlyArray<readonly [T, number]>

const SECOND = 1000
const MINUTE = 60 * SECOND
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR

/** One seeded stream of numbers in [0, 1) per key (FNV-1a into mulberry32). */
const streamOf = (key: string): (() => number) => {
	let state = 2166136261
	for (const char of key) {
		state = Math.imul(state ^ (char.codePointAt(0) ?? 0), 16777619)
	}
	return () => {
		state = (state + 0x6d2b79f5) >>> 0
		let t = state
		t = Math.imul(t ^ (t >>> 15), t | 1)
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296
	}
}

const pick = <T>(random: () => number, items: Weighted<T>): T => {
	const total = items.reduce((sum, [, weight]) => sum + weight, 0)
	let left = random() * total
	for (const [item, weight] of items) {
		left -= weight
		if (left < 0) {
			return item
		}
	}
	const last = items.at(-1)
	if (!last) {
		throw new Error('analytics dev seed: picked from an empty list')
	}
	return last[0]
}

/** A duration between `low` and `high` ms, spread evenly on a log scale as reading times are. */
const between = (random: () => number, low: number, high: number): number =>
	Math.round(low * (high / low) ** random())

/** Where a visitor's browser and network put them. */
export interface Persona {
	ua: string
	acceptLanguage: string
	ip: string
	country: string
	region: string
	city: string
}

const AGENTS: Weighted<string> = [
	[
		'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36',
		20,
	],
	[
		'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1',
		18,
	],
	[
		'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36',
		17,
	],
	[
		'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Mobile Safari/537.36',
		11,
	],
	[
		'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15',
		8,
	],
	[
		'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36 Edg/129.0.0.0',
		7,
	],
	['Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:131.0) Gecko/20100101 Firefox/131.0', 5],
	[
		'Mozilla/5.0 (iPad; CPU OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1',
		3,
	],
	[
		'Mozilla/5.0 (Linux; Android 14; SM-S921B) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/25.0 Chrome/121.0.0.0 Mobile Safari/537.36',
		3,
	],
	['Mozilla/5.0 (X11; Linux x86_64; rv:131.0) Gecko/20100101 Firefox/131.0', 2],
	[
		'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36 OPR/114.0.0.0',
		1.5,
	],
	[
		'Mozilla/5.0 (X11; CrOS x86_64 14541.0.0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36',
		1.5,
	],
	[
		'Mozilla/5.0 (Linux; Android 13; SM-X710) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36',
		1,
	],
]

interface Place {
	country: string
	language: string
	places: ReadonlyArray<readonly [string, string]>
}

const PLACES: Weighted<Place> = [
	[
		{
			country: 'US',
			language: 'en-US',
			places: [
				['California', 'San Francisco'],
				['New York', 'New York'],
				['Texas', 'Austin'],
				['Washington', 'Seattle'],
			],
		},
		26,
	],
	[
		{
			country: 'DE',
			language: 'de-DE',
			places: [
				['Berlin', 'Berlin'],
				['Bavaria', 'Munich'],
				['Hamburg', 'Hamburg'],
			],
		},
		16,
	],
	[
		{
			country: 'GB',
			language: 'en-GB',
			places: [
				['England', 'London'],
				['Scotland', 'Edinburgh'],
			],
		},
		10,
	],
	[
		{
			country: 'FR',
			language: 'fr-FR',
			places: [
				['Ile-de-France', 'Paris'],
				['Auvergne-Rhone-Alpes', 'Lyon'],
			],
		},
		7,
	],
	[{ country: 'NL', language: 'nl-NL', places: [['North Holland', 'Amsterdam']] }, 5],
	[
		{
			country: 'CA',
			language: 'en-CA',
			places: [
				['Ontario', 'Toronto'],
				['British Columbia', 'Vancouver'],
			],
		},
		5,
	],
	[
		{
			country: 'IN',
			language: 'en-IN',
			places: [
				['Karnataka', 'Bengaluru'],
				['Maharashtra', 'Mumbai'],
			],
		},
		5,
	],
	[{ country: 'BR', language: 'pt-BR', places: [['Sao Paulo', 'Sao Paulo']] }, 4],
	[
		{
			country: 'ES',
			language: 'es-ES',
			places: [
				['Madrid', 'Madrid'],
				['Catalonia', 'Barcelona'],
			],
		},
		4,
	],
	[{ country: 'AU', language: 'en-AU', places: [['New South Wales', 'Sydney']] }, 3],
	[{ country: 'SE', language: 'sv-SE', places: [['Stockholm', 'Stockholm']] }, 3],
	[{ country: 'JP', language: 'ja-JP', places: [['Tokyo', 'Tokyo']] }, 3],
	[{ country: 'CH', language: 'de-CH', places: [['Zurich', 'Zurich']] }, 2],
	[{ country: 'PL', language: 'pl-PL', places: [['Masovia', 'Warsaw']] }, 2],
	[{ country: 'IT', language: 'it-IT', places: [['Lombardy', 'Milan']] }, 2],
]

/**
 * How a visit arrives: the referrer the browser sends and the query of the landing page. Between
 * them they make every channel the native engine classifies, and eight campaigns.
 */
interface Arrival {
	referrer?: string
	query?: string
	/** Lands on the pricing page more often than not: a campaign links to what it sells. */
	pricing?: boolean
	/** Lands on a blog post: a link to an article is what another site shares. */
	article?: boolean
}

const ARRIVALS: Weighted<Arrival> = [
	[{}, 22],
	[{ referrer: 'https://www.google.com/search?q=payload+analytics' }, 15],
	[{ referrer: 'https://www.bing.com/search?q=payload+cms+analytics' }, 3],
	[{ referrer: 'https://duckduckgo.com/' }, 2.5],
	[{ referrer: 'https://www.ecosia.org/search?q=cookieless+analytics' }, 1.5],
	[{ referrer: 'https://t.co/9xQz1', article: true }, 2.5],
	[{ referrer: 'https://www.reddit.com/r/nextjs/comments/analytics', article: true }, 2.5],
	[{ referrer: 'https://www.linkedin.com/feed/' }, 2],
	[{ referrer: 'https://www.youtube.com/watch?v=payload-analytics' }, 3],
	[{ referrer: 'https://news.ycombinator.com/item?id=41000000', article: true }, 3],
	[{ referrer: 'https://github.com/10x-media/payload-plugins', article: true }, 2.5],
	[{ referrer: 'https://dev.to/payload/analytics', article: true }, 1.5],
	[{ referrer: 'https://mail.google.com/' }, 1],
	[{ query: 'utm_source=newsletter&utm_medium=email&utm_campaign=spring', pricing: true }, 8],
	[
		{
			referrer: 'https://www.google.com/',
			query: 'utm_source=google&utm_medium=cpc&utm_campaign=brand&gclid=EAIaIQobChMI',
			pricing: true,
		},
		7,
	],
	[
		{
			referrer: 'https://www.facebook.com/',
			query: 'utm_source=facebook&utm_medium=paid-social&utm_campaign=retarget',
			pricing: true,
		},
		5,
	],
	[
		{
			referrer: 'https://t.co/launch',
			query: 'utm_source=twitter&utm_medium=social&utm_campaign=launch',
		},
		2,
	],
	[
		{
			query: 'utm_source=partner-network&utm_medium=affiliate&utm_campaign=review',
			pricing: true,
		},
		4,
	],
	[{ query: 'utm_source=adroll&utm_medium=display&utm_campaign=awareness' }, 3],
	[
		{
			referrer: 'https://www.youtube.com/',
			query: 'utm_source=youtube&utm_medium=paid-video&utm_campaign=launch-video',
		},
		2.5,
	],
	[
		{
			referrer: 'https://www.capterra.com/',
			query: 'utm_source=capterra&utm_medium=cpc&utm_campaign=listing',
			pricing: true,
		},
		2.5,
	],
]

/** The pages every site has, by how often they are read; posts are what other sites link to. */
const SITE_PAGES: Weighted<string> = [
	['/', 30],
	['/pricing', 18],
	['/blog', 12],
	['/about', 9],
	['/contact', 6],
	['/blog/launch-week', 3.2],
	['/blog/privacy-first-analytics', 2.8],
	['/blog/payload-analytics-guide', 2.4],
	['/blog/server-side-tracking', 1.8],
	['/blog/changelog-september', 1.2],
	['/docs/getting-started', 1.5],
	['/careers', 0.8],
]

const isPost = (path: string): boolean => path.startsWith('/blog/')

/** How long a page holds a reader, in ms: low and high ends of a log-uniform spread. */
const dwellRange = (path: string): readonly [number, number] => {
	if (isPost(path) || path.startsWith('/docs/')) {
		return [40 * SECOND, 7 * MINUTE]
	}
	if (path === '/pricing' || path === '/checkout') {
		return [30 * SECOND, 3 * MINUTE]
	}
	if (path === '/thank-you') {
		return [5 * SECOND, 20 * SECOND]
	}
	return [12 * SECOND, 90 * SECOND]
}

/** One site the seed fills: a host, its scope and zone, its volume and what can convert on it. */
export interface SiteProfile {
	/** Seeds every random choice, so two sites never share visits. */
	key: string
	/** The tenant on a scoped install, `''` for its platform's own site; absent on an unscoped one. */
	scope?: string
	hostname: string
	/** The zone its days are cut in, which its visitor ids and its live hours follow. */
	tz: string
	/** Visits on an ordinary weekday. */
	visitsPerDay: number
	/** People who come back on most days, and some days twice. */
	regulars: number
	/** A country weight multiplied, so each tenant has an audience of its own. */
	countryBoost?: Readonly<Record<string, number>>
	/** The editor-managed goal and the page whose CTA completes it. */
	goal?: { slug: string; path: string }
	/** The tenant's offer card, as the signed ref its pages carry. */
	offer?: string
	/** The goal the offer card's button completes. */
	offerGoal?: string
}

/** One beacon the site's visitors send, before ingest has touched it. */
export interface PlannedHit {
	/** Stable per site, day and position: what the stored row's id is derived from. */
	key: string
	/** When it happened; an engagement's is its pageview's. */
	at: Date
	/** When it reached the server: an engagement's when its page was left. */
	arrives: Date
	/** Server code, not a browser: a payment webhook. */
	server: boolean
	raw: RawEventInput
}

export interface PlannedVisit {
	persona: Persona
	/** Names the person on that day for the memory provider, which counts visitors by it. */
	visitor: string
	hits: PlannedHit[]
}

/** The share of each hour of the day's visits that start in it, midnight first. */
const HOURS: Weighted<number> = [
	1, 0.6, 0.4, 0.3, 0.3, 0.5, 1, 2, 3.5, 4.5, 5, 5, 4.6, 4.4, 4.6, 4.8, 4.6, 4.2, 4, 4.2, 4.4, 3.8,
	2.8, 1.8,
].map((weight, hour): readonly [number, number] => [hour, weight])

const WEEKDAY_FACTOR = [0.65, 1, 1.05, 1, 0.95, 0.85, 0.7]

/** Day number since the epoch and weekday of a date, taken from the date itself. */
const dateParts = (day: CalendarDay): { serial: number; weekday: number } => {
	const { year, month, day: date } = calendarDate(day)
	const utc = Date.UTC(year, month - 1, date)
	return { serial: Math.round(utc / DAY), weekday: new Date(utc).getUTCDay() }
}

/** How many visits a date gets: a week's shape, a slow season, and a day's own luck. */
const visitsOn = (site: SiteProfile, day: CalendarDay): number => {
	const { serial, weekday } = dateParts(day)
	const season = 1 + 0.22 * Math.sin((2 * Math.PI * serial) / 120)
	const luck = 0.88 + 0.24 * streamOf(`${site.key}:${day}:volume`)()
	return Math.round(site.visitsPerDay * (WEEKDAY_FACTOR[weekday] ?? 1) * season * luck)
}

const personaOf = (site: SiteProfile, person: number): Persona => {
	const random = streamOf(`${site.key}:person:${person}`)
	const places: Weighted<Place> = PLACES.map(([place, weight]) => [
		place,
		weight * (site.countryBoost?.[place.country] ?? 1),
	])
	const place = pick(random, places)
	const [region, city] = place.places[Math.floor(random() * place.places.length)] ?? ['', '']
	const base = place.language.split('-')[0] ?? 'en'
	return {
		ua: pick(random, AGENTS),
		acceptLanguage: `${place.language},${base};q=0.9,en;q=0.8`,
		ip: `2001:db8:${(person >>> 16).toString(16)}:${(person & 0xffff).toString(16)}::1`,
		country: place.country,
		region,
		city,
	}
}

const purchaseOf = (
	persona: Persona,
	random: () => number
): { value: number; currency: string } => {
	const tier = Math.floor(random() * 3)
	if (persona.country === 'US' || persona.country === 'CA') {
		return { value: [49, 99, 199][tier] ?? 49, currency: 'USD' }
	}
	if (persona.country === 'GB') {
		return { value: [39, 79, 159][tier] ?? 39, currency: 'GBP' }
	}
	return { value: [45, 89, 179][tier] ?? 45, currency: 'EUR' }
}

interface VisitArgs {
	site: SiteProfile
	day: CalendarDay
	/** Names the visit within its day: its index, or its live slot. */
	label: string
	start: Date
	person: number
	regular: boolean
}

/** The pages a visit can move to: the site's own, its goal page, never another tenant's. */
const pagesOf = (site: SiteProfile): Weighted<string> =>
	site.goal ? [...SITE_PAGES, [site.goal.path, 2.5]] : SITE_PAGES

/**
 * One visit: a landing from where its arrival says, a few pages read with an engagement as each is
 * left, and whatever the reader does on them. Nothing converts on the home page: the e2e specs
 * convert there themselves, and one of them proves a tenant's home holds no conversion at all.
 */
const planVisit = ({ site, day, label, start, person, regular }: VisitArgs): PlannedVisit => {
	const random = streamOf(`${site.key}:${day}:${label}`)
	const persona = personaOf(site, person)
	const pages = pagesOf(site)
	const posts = pages.filter(([path]) => isPost(path))
	const arrival: Arrival = regular && random() < 0.6 ? {} : pick(random, ARRIVALS)
	const hits: PlannedHit[] = []
	let clock = start.getTime()
	const hit = (
		at: number,
		raw: RawEventInput,
		also: { arrives?: number; server?: boolean } = {}
	) => {
		hits.push({
			key: `${site.key}:${day}:${label}:${hits.length}`,
			at: new Date(at),
			arrives: new Date(also.arrives ?? at),
			server: also.server === true,
			raw,
		})
	}
	let path =
		arrival.pricing && random() < 0.6
			? '/pricing'
			: arrival.article
				? pick(random, posts)
				: pick(random, pages)
	let previous: string | undefined
	for (let step = 0; step < 8; step++) {
		const [low, high] = dwellRange(path)
		const dwell = between(random, low, high)
		const during = (share: number): number => clock + Math.round(dwell * share)
		hit(clock, {
			type: 'pageview',
			path,
			scrollDepth: 0,
			...(previous === undefined
				? { referrer: arrival.referrer, query: arrival.query }
				: { referrer: `https://${site.hostname}${previous}`, nav: 1 }),
		})
		let next: string | undefined
		let ended = false
		const cardShown = site.offer !== undefined && random() < 0.75
		if (path === '/pricing' && random() < 0.015) {
			hit(during(0.4), { type: 'goal', name: 'book-demo', path })
			next = '/thank-you'
		} else if (path === '/pricing' && random() < 0.018) {
			next = '/checkout'
		} else if (path === '/checkout') {
			const order = { orderId: `${site.key}-${day}-${label}`, ...purchaseOf(persona, random) }
			if (random() < 0.15) {
				hit(
					during(0.9),
					{ type: 'goal', name: PURCHASE_GOAL_SLUG, path: '/api/payments/webhook', ...order },
					{ server: true }
				)
			} else {
				hit(during(0.6), { type: 'goal', name: PURCHASE_GOAL_SLUG, path, ...order })
			}
			ended = true
		} else if ((path === '/pricing' || path === '/blog') && random() < 0.05) {
			hit(during(0.5), { type: 'event', name: 'signup', path })
		} else if (isPost(path) && random() < 0.06) {
			hit(during(0.7), { type: 'event', name: 'download', path })
		} else if (path === '/about' && random() < 0.1) {
			hit(during(0.3), { type: 'event', name: 'video-play', path })
		} else if (site.goal && path === site.goal.path && random() < 0.28) {
			hit(during(0.5), { type: 'goal', name: site.goal.slug, path })
		}
		if (site.offer && cardShown && path !== '/' && random() < 0.1) {
			hit(during(0.6), { type: 'event', name: ITEM_CLICK_EVENT, path, item: site.offer })
			if (site.offerGoal && random() < 0.12) {
				hit(during(0.8), { type: 'goal', name: site.offerGoal, path, item: site.offer })
			}
		}
		if (path === '/thank-you') {
			ended = true
		}
		if (random() < 0.85) {
			hit(
				clock,
				{
					type: 'engagement',
					path,
					durationMs: Math.min(Math.round(dwell * (0.6 + 0.4 * random())), 30 * MINUTE),
					scrollDepth: 20 + Math.floor(random() * (isPost(path) ? 81 : 61)),
					...(cardShown && site.offer ? { impressions: [site.offer] } : {}),
				},
				{ arrives: clock + dwell }
			)
		}
		const leaves = step === 0 ? 0.42 : 0.38
		if (ended || (next === undefined && random() < leaves)) {
			break
		}
		previous = path
		const options = pages.filter(([candidate]) => candidate !== path)
		path = next ?? pick(random, options)
		clock += dwell + between(random, 1 * SECOND, 8 * SECOND)
	}
	return { persona, visitor: `${site.key}-p${person}-${day}`, hits }
}

/** The instant a share of a local day falls on, minutes and seconds drawn too. */
const timeIn = (site: SiteProfile, day: CalendarDay, random: () => number): Date => {
	const hour = pick(random, HOURS)
	const offset = hour * HOUR + Math.floor(random() * HOUR)
	return new Date(calendarDayStart(day, site.tz).getTime() + offset)
}

/** Live slots are ten minutes long; the last three before now keep the realtime widgets busy. */
const LIVE_SLOT_MS = 10 * MINUTE
const LIVE_SLOTS = 3

/**
 * A date's visits, as a deterministic model of a small site: regulars on most days (some twice,
 * hours apart) and new people otherwise, at the hours a site is busy. A past day's plan depends on
 * the site and the date alone, so planning it again on a later boot yields the same hits. Today
 * also gets two visits in each of the last three ten-minute slots before `now`, keyed by their
 * slot, so a later boot that day adds new ones and repeats none.
 */
export const planDay = (site: SiteProfile, day: CalendarDay, now: Date): PlannedVisit[] => {
	const random = streamOf(`${site.key}:${day}:people`)
	const visits: PlannedVisit[] = []
	const count = visitsOn(site, day)
	for (let index = 0; index < count; index++) {
		const regular = random() < 0.35
		const person = regular
			? Math.floor(random() * site.regulars)
			: site.regulars + Math.floor(random() * 1_000_000)
		const start = timeIn(site, day, random)
		visits.push(planVisit({ site, day, label: `v${index}`, start, person, regular }))
		if (regular && random() < 0.18) {
			const later = new Date(start.getTime() + between(random, 2 * HOUR, 6 * HOUR))
			visits.push(
				planVisit({ site, day, label: `v${index}b`, start: later, person, regular: true })
			)
		}
	}
	if (calendarDayOf(now, site.tz) !== day) {
		return visits
	}
	const dayStart = calendarDayStart(day, site.tz).getTime()
	const slot = Math.floor((now.getTime() - dayStart) / LIVE_SLOT_MS)
	for (let back = 1; back <= LIVE_SLOTS; back++) {
		const live = slot - back + 1
		if (live < 0) {
			continue
		}
		const slotRandom = streamOf(`${site.key}:${day}:live:${live}`)
		for (const seat of [0, 1]) {
			const start = new Date(dayStart + live * LIVE_SLOT_MS + Math.floor(slotRandom() * 8 * MINUTE))
			visits.push(
				planVisit({
					site,
					day,
					label: `live${live}-${seat}`,
					start,
					person: site.regulars + 2_000_000 + live * 2 + seat,
					regular: false,
				})
			)
		}
	}
	return visits
}

/** An id's random part, fixed by its key: the same planned hit is the same row on every boot. */
export const idEntropy = (key: string): Uint8Array =>
	createHash('sha256').update(`analytics-dev-seed:${key}`).digest().subarray(0, 10)
