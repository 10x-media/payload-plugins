import { ulid } from '../../src/native/store/ids'
import type { HitRow } from '../../src/native/store/types'

export const at = (iso: string): Date => new Date(iso)

export type HitDraft = Partial<HitRow> & Pick<HitRow, 'ts'>

/** A hit of `scope`: a non-landing pageview on `/` by one visitor unless the draft overrides it. */
export const hitOf = (scope: string, draft: HitDraft): HitRow => ({
	id: ulid(draft.ts),
	scope,
	type: 'pageview',
	hostname: 'a.example',
	path: '/',
	v: 'V000000000000001',
	landing: false,
	server: false,
	...draft,
})

const GOOGLE = { ref: 'google.com', source: 'google', channel: 'organic-search' } as const
const DIRECT = { source: 'direct', channel: 'direct' } as const

/** A landing from a search engine, carrying the campaign it was tagged with. */
export const fromGoogle = (campaign?: string): Partial<HitRow> => ({
	...GOOGLE,
	landing: true,
	...(campaign === undefined ? {} : { utmCampaign: campaign, utmSource: 'google' }),
})

/** An internal pageview: no referrer of its own, so on its own it reads as direct. */
export const internal: Partial<HitRow> = { ...DIRECT, landing: false }

/** Mulberry32: a small seeded generator, so a failing fixture is the same fixture next run. */
export const seededRandom = (seed: number): (() => number) => {
	let state = seed >>> 0
	return () => {
		state = (state + 0x6d2b79f5) >>> 0
		let t = state
		t = Math.imul(t ^ (t >>> 15), t | 1)
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296
	}
}

const MINUTE = 60_000
const DAY = 86_400_000

const LANDINGS: ReadonlyArray<Partial<HitRow>> = [
	{ ...GOOGLE },
	{ ref: 'bing.com', source: 'bing', channel: 'organic-search', clickId: 'msclkid' },
	{ ref: 'news.example', source: 'news.example', channel: 'referral' },
	{
		source: 'newsletter',
		channel: 'email',
		utmSource: 'newsletter',
		utmMedium: 'email',
		utmCampaign: 'fall_sale',
		utmContent: 'hero',
		utmTerm: 'boots',
	},
	{ ...DIRECT },
]

/** `/！` sorts before `/🎉` by code point and after it by UTF-16 unit. */
const PAGES = [
	'/',
	'/pricing',
	'/blog/a',
	'/blog/b_c',
	'/sale_50%',
	'/SALE-50x',
	'/docs/x',
	'/über',
	'/！',
	'/🎉',
]

const PLACES: ReadonlyArray<Partial<HitRow>> = [
	{ country: 'DE', region: 'BE', city: 'Berlin', language: 'de' },
	{ country: 'US', region: 'CA', city: 'San Francisco', language: 'en-us' },
	{ country: 'FR', region: 'IDF', city: 'Paris', language: 'fr' },
	{ country: 'BR', language: 'pt-br' },
]

const DEVICES: ReadonlyArray<Partial<HitRow>> = [
	{ device: 'desktop', browser: 'chrome', os: 'macos' },
	{ device: 'mobile', browser: 'safari', os: 'ios' },
	{ device: 'tablet', browser: 'firefox', os: 'android' },
]

const ITEMS = ['offers:1', 'offers:2', 'offers:3']

export interface RandomFixture {
	hits: HitRow[]
	/** The UTC midnight starting each day the fixture covers, and the one after the last. */
	days: Date[]
}

/**
 * A few hundred hits over four days and two hostnames, with gaps of exactly 30 minutes and early
 * engagements; goals are worth whole quarters so every database sums them exactly.
 */
export const randomFixture = (seed: number, scope: string, other: string): RandomFixture => {
	const random = seededRandom(seed)
	const pickOf = <T>(items: readonly T[]): T => {
		const item = items[Math.floor(random() * items.length)]
		if (item === undefined) {
			throw new Error('picked from nothing')
		}
		return item
	}
	const integer = (low: number, high: number): number =>
		low + Math.floor(random() * (high - low + 1))
	const first = Date.UTC(2026, 8, 28)
	const days = Array.from({ length: 5 }, (_, i) => new Date(first + i * DAY))
	const hits: HitRow[] = []
	let serial = 0
	/** Ids made from the seed alone, so a run can be replayed exactly. */
	const id = (ts: Date): string => `${ulid(ts).slice(0, 10)}F${String(serial++).padStart(15, '0')}`
	for (let day = 0; day < 4; day++) {
		const dayEnd = first + (day + 1) * DAY
		for (const hostname of ['a.example', 'b.example']) {
			for (let person = 0; person < 7; person++) {
				const v = `D${day}${hostname.slice(0, 1)}P${person}`.padEnd(16, 'x')
				const place = pickOf(PLACES)
				const device = pickOf(DEVICES)
				let clock = first + day * DAY + integer(0, 20) * 30 * MINUTE + integer(0, 59) * 1000
				const visits = integer(1, 3)
				for (let visit = 0; visit < visits; visit++) {
					const steps = integer(1, 6)
					for (let step = 0; step < steps && clock < dayEnd; step++) {
						const ts = new Date(clock)
						const base = { ...place, ...device, hostname, v, ts }
						const roll = random()
						if (step === 0 || roll < 0.45) {
							const landing = step === 0 && random() < 0.75
							hits.push({
								...hitOf(scope, base),
								id: id(ts),
								path: pickOf(PAGES),
								...(landing ? { ...pickOf(LANDINGS), landing: true } : internal),
								...(random() < 0.5 ? { scrollDepth: 0 } : {}),
							})
						} else if (roll < 0.6) {
							const name = pickOf(['signup', 'download', 'item_click'])
							hits.push({
								...hitOf(scope, base),
								id: id(ts),
								type: 'event',
								name,
								path: pickOf(PAGES),
								...internal,
								...(name === 'item_click' ? { item: pickOf(ITEMS) } : {}),
							})
						} else if (roll < 0.72) {
							const value = integer(1, 40) * 0.25
							const goals = [
								{ slug: 'purchase', value },
								...(random() < 0.3 ? [{ slug: 'any-sale', value: 0 }] : []),
							]
							hits.push({
								...hitOf(scope, base),
								id: random() < 0.3 ? `os.${String(serial++).padStart(8, '0')}` : id(ts),
								type: 'goal',
								name: 'purchase',
								path: '/checkout',
								...internal,
								server: random() < 0.3,
								value,
								currency: pickOf(['EUR', 'USD']),
								conversions: goals.length,
								revenue: value,
								goals,
								...(random() < 0.4 ? { item: pickOf(ITEMS) } : {}),
							})
						} else {
							const seen =
								random() < 0.5 ? [pickOf(ITEMS), ...(random() < 0.4 ? ['offers:9'] : [])] : []
							hits.push({
								id: id(ts),
								scope,
								hostname,
								v,
								ts: new Date(clock + (random() < 0.3 ? -20 : 15)),
								lastAt: new Date(clock + integer(1, 40) * MINUTE),
								type: 'engagement',
								path: pickOf(PAGES),
								landing: false,
								server: false,
								durationMs: integer(1, 600) * 1000,
								...(random() < 0.6 ? { scrollDepth: integer(1, 60) } : {}),
								...(seen.length > 0 ? { impressions: seen } : {}),
							})
						}
						const gap = random()
						clock +=
							gap < 0.05
								? 0
								: gap < 0.15
									? 30 * MINUTE
									: gap < 0.25
										? 31 * MINUTE
										: integer(1, 25) * MINUTE
					}
					clock += integer(31, 240) * MINUTE
				}
			}
		}
		for (let sale = 0; sale < 3; sale++) {
			const ts = new Date(first + day * DAY + integer(0, 1439) * MINUTE)
			const value = integer(4, 80) * 0.25
			hits.push({
				...hitOf(scope, { ts }),
				id: id(ts),
				v: '',
				type: 'goal',
				name: 'purchase',
				path: '/api/webhook',
				server: true,
				value,
				currency: 'EUR',
				conversions: 1,
				revenue: value,
				goals: [{ slug: 'purchase', value }],
			})
		}
		const ts = new Date(first + day * DAY + 12 * 60 * MINUTE)
		hits.push({
			...hitOf(other, { ts }),
			id: id(ts),
			v: `D${day}O`.padEnd(16, 'x'),
			...fromGoogle(),
			path: '/other',
		})
	}
	return { hits, days }
}
