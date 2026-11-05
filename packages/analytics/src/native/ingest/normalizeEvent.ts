import { isRecord } from '../../core/values'
import { MAX_ENGAGEMENT_MS, MAX_ITEMS_PER_BEACON, MAX_SINCE_MS } from '../../goals/constants'
import type { CurrencyConverter } from '../../goals/currency'
import { sanitizeItems } from '../../goals/items'
import {
	type BrowserAmounts,
	type CompletionAmount,
	completionAmounts,
	DEFAULT_BROWSER_AMOUNTS,
	type GoalCompletion,
} from '../../goals/match'
import type { Goal } from '../../goals/types'
import type { ItemIdType } from '../../items/idType'
import { boundItemRef } from '../../items/ref'
import type { TrustedPlatform } from '../../net/platform'
import { MAX_GEO_LENGTH, MAX_QUERY_LENGTH } from '../../query/limits'
import type { GeoResolver } from '../geo/geoResolver'
import { resolveGeo } from '../geo/resolveGeo'
import type { HitMode, HitType } from '../store/types'
import { type BrowserName, classifyBrowser, classifyOs, type OsName } from './browser'
import { clientIpFromHeaders } from './clientIp'
import { classifyDevice, type DeviceType, SERVER_USER_AGENT } from './device'
import { type ItemSignatureCheck, verifiedItemRef } from './itemSignature'
import { primaryLanguage } from './language'
import { isSiteReferral, referrerHost, storedReferrer } from './referrer'
import { MAX_HOSTNAME_LENGTH } from './requestHost'
import {
	boundedValue,
	dedupeKeyFor,
	type IngestOrigin,
	isRefund,
	type Money,
	reconcileMoney,
	sanitizeOrderId,
} from './revenue'
import { clickIdOf } from './source'
import { extractUtm } from './utm'
import { boundedSinceMs, isNavigation } from './validate'
import { dailyVisitorId } from './visitorHash'

/**
 * One event as the tracker or `trackServerEvent` sends it, before the ingest normalizes it.
 * @beta
 */
export interface RawEventInput {
	/** An `engagement` gets a row of its own so a filtered read finds it, never counted as a hit. */
	type: HitType
	/** Event name, or the goal slug on a `goal`. Absent on a pageview and an engagement. */
	name?: string
	path: string
	/**
	 * The hostname the client claims. Ignored by the HTTP ingest, which attributes an event to
	 * the request that carried it; `trackServerEvent` supplies its own and it is used as sent.
	 */
	hostname?: string
	referrer?: string
	/**
	 * Query string without its leading `?`. Read for campaign keys and never stored, so a session
	 * token or email address in the URL never lands in a hit.
	 */
	query?: string
	/**
	 * Engaged time an engagement adds. Kept on a pageview too, which is what a tracker cached
	 * from before engagement existed still sends; dropped on every other type.
	 */
	durationMs?: number
	/**
	 * On an engagement only: ms since its pageview was sent, by the page's own clock so the device's
	 * date never matters. Read by {@link eventTime}, never stored.
	 */
	sinceMs?: number
	/**
	 * How long the event waited in the page before it was sent, by the page's own clock: a pending
	 * gate or a prerender held it. Read by {@link eventTime}, never stored.
	 */
	ageMs?: number
	/** `1` on a pageview a single-page app made in place, without loading a document. */
	nav?: number
	props?: Record<string, unknown>
	/** Revenue for a goal completion, in `currency`. */
	value?: number
	currency?: string
	/**
	 * The lines of a sale. Sanitized and stored under `props.items`, so a read of the event
	 * carries the order without a second collection.
	 */
	items?: unknown
	/**
	 * Marks a server `purchase` or `refund`, the one path a negative `value` is allowed on. The wire
	 * refuses it: a forged refund subtracts from revenue it never added to.
	 */
	revenue?: boolean
	/**
	 * The order this amount belongs to. The order's hit is keyed by a digest of it, so a retried
	 * payment webhook counts once however often it arrives; the id itself is stored nowhere.
	 */
	orderId?: string
	/**
	 * On a server refund, the refund's own id as the payment provider names it: it joins the order
	 * id in the refund's key, so each partial refund counts once however often it is retried.
	 */
	refundId?: string
	/**
	 * On a pageview, its scroll depth, 0 when the tracker measures it afterwards; on an
	 * engagement, how much deeper the page was scrolled since the previous one. 0-100.
	 */
	scrollDepth?: number
	/**
	 * Item ref (`<collection>:<id>`), server-signed when a page sends it (`offers:12@<signature>`).
	 * Dropped, keeping the event, unless verified and of a collection bound as an item.
	 */
	item?: string
	/**
	 * On an engagement only: item values seen since the previous one, each checked like `item` and
	 * capped at one beacon's worth.
	 */
	impressions?: unknown
	/**
	 * How the page measured this beacon; absent is `f`, which a tracker from before modes sends.
	 * Ingest stores no more than the mode allows, whatever else the beacon carries.
	 */
	m?: HitMode
}

/**
 * An event once ingest has sanitized, attributed and matched it: what `toHit` shapes into the row
 * that is stored. Nothing here is written as it stands.
 */
export interface NormalizedEvent {
	/** When it arrived, or for an engagement its pageview's start; see {@link eventTime}. */
	timestamp: Date
	type: HitType
	name?: string
	path: string
	hostname: string
	/**
	 * Origin and path only, the query string and fragment stripped: whether a pageview opens a
	 * visit is decided by it. Never stored.
	 */
	referrer?: string
	/** The referrer's bare host, which a landing stores as `ref`; absent for the site's own. */
	referrerHost?: string
	/**
	 * The referrer is another hostname its scope records hits under: a link inside the site, which
	 * opens no visit, whatever hostname it led to.
	 */
	siteReferrer?: boolean
	device?: DeviceType
	browser?: BrowserName
	os?: OsName
	/** The five campaign keys extracted from the wire `query`; absent when it carried none. */
	utmSource?: string
	utmMedium?: string
	utmCampaign?: string
	utmContent?: string
	utmTerm?: string
	country?: string
	region?: string
	city?: string
	/** Primary `Accept-Language` tag, lowercased (`de-de`). */
	language?: string
	durationMs?: number
	props?: Record<string, unknown>
	value?: number
	/**
	 * ISO 4217 code of `value`: as sent without `revenue.currency`, else always the reporting
	 * currency, with the `original` fields holding what arrived.
	 */
	currency?: string
	/** The amount as sent, present only when it is not what `value` holds. */
	originalValue?: number
	originalCurrency?: string
	/**
	 * The order hit's primary key derives from it, so the database refuses a second row for one order
	 * even when two retries race.
	 */
	dedupeKey?: string
	/** A server refund: its completions count their negative amount in revenue and no conversion. */
	refund?: true
	scrollDepth?: number
	/**
	 * Goals this event completed, resolved against the install's goals at ingest so a later
	 * goal edit never rewrites history.
	 */
	goals?: GoalCompletion[]
	/** Set only in scoped installs; '' is the null scope. */
	scope?: string
	/** The content item this event or goal belongs to, as its ref. */
	item?: string
	/** Items seen on screen since the previous engagement, on an engagement only. */
	impressions?: string[]
	/**
	 * The day's visitor id: 16 characters of a keyed hash of the address, the agent and the site,
	 * or `''` for a server event with neither an address nor a user agent of its own.
	 */
	visitorId: string
	/** The ad click id the query carried, by name (`gclid`, `fbclid`). */
	clickId?: string
	/** A pageview a single-page app made in place (`nav: 1`). */
	navigation?: boolean
	/** Recorded by server code rather than sent by a browser. */
	server?: boolean
	/** Absent is `f`. */
	mode?: HitMode
}

interface NormalizeArgs {
	raw: RawEventInput
	/** Already resolved and capped: what the event is attributed to, not what it claimed. */
	hostname: string
	headers: Headers
	geoResolver: GeoResolver
	/** Where a throwing resolver is reported; the event is stored without a location either way. */
	warnGeo?: (message: string) => void
	/** The salt of the visitor's day, which the visitor id is hashed with. */
	salt: string
	now: Date
	scope?: string
	goals?: Goal[]
	/**
	 * Revenue semantics belong to `'server'` alone, so the default is the unprivileged origin and
	 * only `trackServerEvent` passes the other.
	 */
	origin?: IngestOrigin
	/**
	 * `revenue.browserAmounts`: how far an amount a browser sent is believed. Read for
	 * `origin: 'wire'` alone; absent, `DEFAULT_BROWSER_AMOUNTS`.
	 */
	browserAmounts?: BrowserAmounts
	/** The install's reporting currency; undefined stores and sums amounts exactly as sent. */
	reportingCurrency?: string
	convertCurrency?: CurrencyConverter
	/** Called at most once per process when an amount could not be converted. */
	warnUnconverted?: () => void
	/** Trusted proxies in front of the app, for the client address the hash and geo read. */
	trustedProxyHops?: number
	/** The platform whose edge headers carry the client address and location, when trusted. */
	trustedPlatform?: TrustedPlatform
	/** The collections bound as items, whose refs alone are kept. Absent keeps no item at all. */
	items?: ItemIngestOptions
	/**
	 * The other hostnames the event's scope records hits under, bare: a referrer on one of them is
	 * the site's own page, never a referral.
	 */
	siblings?: ReadonlySet<string>
	/** `orderDigestKey` of the instance's secret, which an order's key is digested with. */
	orderKey?: Buffer
	/**
	 * What the event may store: `a` hashes no visitor and keeps country alone, no time, scroll or
	 * items seen. Absent is `f`, as for a beacon without `m`.
	 */
	mode?: HitMode
}

export interface ItemIngestOptions {
	collections: ReadonlySet<string>
	/**
	 * Each bound collection's id type, known once the database adapter is (at init). A ref whose
	 * id cannot be one of its collection's ids is dropped like an unbound one.
	 */
	idTypes?: ReadonlyMap<string, ItemIdType>
	/**
	 * How a ref's signature is checked, known once the instance's secret is. Absent, nothing a page
	 * sends can be verified, so only server code's own items are kept.
	 */
	signature?: ItemSignatureCheck
}

const MAX_PROPS = 20
const MAX_KEY_LENGTH = 64
const MAX_VALUE_LENGTH = 256
const MAX_NAME_LENGTH = 128
const MAX_PATH_LENGTH = 512
const CURRENCY = /^[A-Z]{3}$/

/**
 * When an event happened: its arrival less its `ageMs`, and an engagement's `sinceMs` too, so it is
 * filed at its pageview's start. Each is believed from 0 to a day, and together reach back a day.
 */
export const eventTime = (
	raw: Pick<RawEventInput, 'type' | 'sinceMs' | 'ageMs'>,
	receivedAt: Date
): Date => {
	const waited = boundedSinceMs(raw.ageMs) ?? 0
	const since = raw.type === 'engagement' ? (boundedSinceMs(raw.sinceMs) ?? 0) : 0
	const back = Math.min(MAX_SINCE_MS, waited + since)
	return back === 0 ? receivedAt : new Date(receivedAt.getTime() - back)
}

/**
 * Whether an event comes with a visitor of its own: an address, or a user agent other than the
 * one server tracking stamps when it has none. A beacon always does; server code may not.
 */
const identifiesVisitor = (ip: string, ua: string): boolean =>
	ip !== '' || (ua !== '' && ua !== SERVER_USER_AGENT)

/**
 * Optional wire fields are sanitized rather than rejected, so one malformed attribute never costs
 * a pageview.
 */
const nonNegative = (value: unknown): number | undefined => {
	const bounded = boundedValue(value)
	return bounded !== undefined && bounded >= 0 ? bounded : undefined
}

/** A refund is the one negative amount ingest keeps, and only on a server `refund` call. */
const signed = (value: unknown): number | undefined => boundedValue(value)

const currencyCode = (value: unknown): string | undefined =>
	typeof value === 'string' && CURRENCY.test(value) ? value : undefined

/**
 * The event's amount as far as it is believed: as sent under `trust` and `fixed` (where a goal's
 * fixed value still wins for its own completion), nothing under `none`.
 */
export const sentAmount = (args: {
	value: number | undefined
	currency: string | undefined
	believed: BrowserAmounts
}): { value?: number; currency?: string } =>
	args.believed === 'none'
		? {}
		: {
				...(args.value === undefined ? {} : { value: args.value }),
				...(args.currency === undefined ? {} : { currency: args.currency }),
			}

/** One completion as counted, and the money its amount came to, absent for one worth nothing. */
interface CountedCompletion {
	completion: GoalCompletion
	money?: Money
}

/**
 * Each completion reconciled on its own (a fixed value in its goal's currency, else the event's),
 * one conversion per distinct amount however many goals share it.
 */
const countCompletions = async (
	amounts: readonly CompletionAmount[],
	args: {
		eventCurrency: string | undefined
		reconcile: (value: number, currency: string | undefined) => Promise<Money>
	}
): Promise<CountedCompletion[]> => {
	const counted: CountedCompletion[] = []
	for (const { goal, source, amount } of amounts) {
		if (source === 'none') {
			counted.push({ completion: { slug: goal.slug, value: 0 } })
			continue
		}
		const currency = source === 'fixed' ? currencyCode(goal.currency) : args.eventCurrency
		const money = await args.reconcile(amount, currency)
		counted.push({
			completion: {
				slug: goal.slug,
				value: money.value ?? 0,
				...(money.originalValue === undefined ? {} : { sent: money.originalValue }),
			},
			money,
		})
	}
	return counted
}

/**
 * Infinity would poison every average for good, and a string would throw out of the write and take
 * the buffered batch with it.
 */
const duration = (value: unknown): number | undefined => {
	const n = nonNegative(value)
	return n === undefined || n > MAX_ENGAGEMENT_MS ? undefined : n
}

/** The event name is a value the `event` dimension groups by, so it is length-capped. */
const eventName = (value: unknown): string | undefined =>
	typeof value === 'string' ? value.slice(0, MAX_NAME_LENGTH) : undefined

/**
 * Capped, not trusted: the resolver reads headers a client can set. An empty value stays absent,
 * since '' would be a value of its own.
 */
const geoValue = (value: string | undefined): string | undefined =>
	value ? value.slice(0, MAX_GEO_LENGTH) : undefined

/** Capped before it is parsed, so a hostile query cannot make ingest do unbounded work. */
const queryString = (value: unknown): string | undefined =>
	typeof value === 'string' ? value.slice(0, MAX_QUERY_LENGTH) : undefined

const depth = (value: unknown): number | undefined => {
	const n = nonNegative(value)
	return n === undefined ? undefined : Math.round(Math.min(n, 100))
}

/**
 * Flat JSON scalars only, first 20 short-keyed entries. An order's event drops an `orderId` prop:
 * an order is kept as its digest alone.
 */
const sanitizeProps = (raw: unknown, order: boolean): Record<string, unknown> | undefined => {
	if (!isRecord(raw) || Array.isArray(raw)) {
		return undefined
	}
	const out: Record<string, unknown> = {}
	let kept = 0
	for (const [key, value] of Object.entries(raw)) {
		if (kept >= MAX_PROPS || key.length > MAX_KEY_LENGTH || (order && key === 'orderId')) {
			continue
		}
		if (typeof value === 'string') {
			out[key] = value.slice(0, MAX_VALUE_LENGTH)
		} else if (
			typeof value === 'boolean' ||
			(typeof value === 'number' && Number.isFinite(value))
		) {
			out[key] = value
		} else {
			continue
		}
		kept++
	}
	return kept > 0 ? out : undefined
}

/**
 * An engagement adds only time, scroll and items seen; time and scroll count from a pageview or an
 * engagement alone, and only an event or a goal belongs to an item.
 */
const fieldsOfType = (raw: RawEventInput): RawEventInput => {
	if (raw.type === 'engagement') {
		const { type, path, hostname, referrer, query, durationMs, scrollDepth, impressions } = raw
		return { type, path, hostname, referrer, query, durationMs, scrollDepth, impressions }
	}
	if (raw.type === 'pageview') {
		const { item: _item, impressions: _impressions, ...pageview } = raw
		return pageview
	}
	const {
		durationMs: _durationMs,
		scrollDepth: _scrollDepth,
		impressions: _impressions,
		...hit
	} = raw
	return hit
}

/** An anonymous event keeps no time, scroll or items seen: engagement is a visitor's alone. */
const fieldsOfMode = (raw: RawEventInput, mode: HitMode): RawEventInput => {
	if (mode !== 'a') {
		return raw
	}
	const { durationMs: _durationMs, scrollDepth: _scrollDepth, impressions: _seen, ...kept } = raw
	return kept
}

/**
 * The ref an item value is kept under: signed by this server (or trusted, or unsigned where
 * signatures are optional), of a bound collection, with an id that collection could hold.
 */
const keptItemRef = (
	value: unknown,
	options: ItemIngestOptions,
	origin: IngestOrigin
): string | undefined => {
	const ref = verifiedItemRef(value, options.signature, origin === 'server')
	return ref === undefined ? undefined : boundItemRef(ref, options.collections, options.idTypes)
}

/**
 * The refs of the items an engagement saw, each kept, once each, and no more than one beacon
 * carries. Anything else in the list is dropped rather than failing the engagement.
 */
const seenItems = (
	value: unknown,
	options: ItemIngestOptions | undefined,
	origin: IngestOrigin
): string[] => {
	if (!options || !Array.isArray(value)) {
		return []
	}
	const refs = new Set<string>()
	for (const entry of value) {
		if (refs.size >= MAX_ITEMS_PER_BEACON) {
			break
		}
		const ref = keptItemRef(entry, options, origin)
		if (ref !== undefined) {
			refs.add(ref)
		}
	}
	return [...refs]
}

/** One event sanitized, attributed and goal-matched, alike for a beacon and for server code. */
export async function normalizeEvent({
	raw: input,
	hostname: rawHostname,
	headers,
	geoResolver,
	warnGeo,
	salt,
	now,
	scope,
	goals,
	origin = 'wire',
	browserAmounts = DEFAULT_BROWSER_AMOUNTS,
	reportingCurrency,
	convertCurrency,
	warnUnconverted,
	trustedProxyHops,
	trustedPlatform,
	items: itemOptions,
	siblings,
	orderKey,
	mode = 'f',
}: NormalizeArgs): Promise<NormalizedEvent> {
	const anonymous = mode === 'a'
	const raw = fieldsOfMode(fieldsOfType(input), mode)
	const item = itemOptions ? keptItemRef(raw.item, itemOptions, origin) : undefined
	const impressions = seenItems(raw.impressions, itemOptions, origin)
	const trust = { trustedProxyHops, trustedPlatform }
	const geo = await resolveGeo(geoResolver, headers, { trust, warn: warnGeo })
	// An anonymous event's address is read for its country alone, never hashed.
	const ip = anonymous ? '' : (clientIpFromHeaders(headers, trust) ?? '')
	const ua = headers.get('user-agent') ?? ''
	// Every value a daily total is keyed by is capped first: Mongo's index key limit and Postgres'
	// 2704-byte btree key both fail the write. Geo, name, query and referrer cap below.
	const path = raw.path.slice(0, MAX_PATH_LENGTH)
	const hostname = rawHostname.slice(0, MAX_HOSTNAME_LENGTH)
	const items = sanitizeItems(raw.items)
	const sanitized = sanitizeProps(raw.props, raw.orderId !== undefined)
	// The lines ride under props rather than in a column of their own: they are read back with
	// the event, never grouped or filtered on, and `sanitizeProps` keeps scalars only.
	const props = items === undefined ? sanitized : { ...sanitized, items }
	const name = eventName(raw.name)
	const isRevenue = origin === 'server' && raw.revenue === true
	const refund = isRefund(isRevenue, raw.value)
	const believed: BrowserAmounts = origin === 'server' ? 'trust' : browserAmounts
	// A server-only goal (`browser: false`) is one a browser cannot complete, whatever it sends.
	const candidates = origin === 'wire' ? goals?.filter((goal) => goal.browser !== false) : goals
	const matching = Boolean(candidates?.length) && raw.type !== 'engagement'
	const eventCurrency = currencyCode(raw.currency)
	const sent = sentAmount({
		value: isRevenue ? signed(raw.value) : nonNegative(raw.value),
		currency: eventCurrency,
		believed,
	})
	const reconciled = new Map<string, Promise<Money>>()
	const reconcile = (value: number | undefined, currency: string | undefined): Promise<Money> => {
		const key = JSON.stringify([value ?? null, currency ?? null])
		const known = reconciled.get(key)
		if (known) {
			return known
		}
		const money = reconcileMoney({
			...(value === undefined ? {} : { value }),
			...(currency === undefined ? {} : { currency }),
			reportingCurrency,
			convertCurrency,
			at: now,
			warn: warnUnconverted,
		})
		reconciled.set(key, money)
		return money
	}
	// Match on the sanitized fields, each completion's amount reconciled on its own, so a rejected
	// value never reaches a goal's revenue and a converted one is what revenue sums.
	const counted =
		matching && candidates
			? await countCompletions(
					completionAmounts({ type: raw.type, name, path, props, value: sent.value }, candidates, {
						allowNegativeValue: isRevenue,
						props: believed !== 'none',
						fixedFirst: believed !== 'trust',
					}),
					{ eventCurrency, reconcile }
				)
			: []
	const completions = counted.map((each) => each.completion)
	// The row carries the money of its first completion worth something, else the event's own.
	const money =
		counted.find((each) => each.money !== undefined)?.money ??
		(await reconcile(sent.value, sent.currency))
	const order = sanitizeOrderId(raw.orderId)
	const refundId = refund ? sanitizeOrderId(raw.refundId) : undefined
	const scrollDepth = depth(raw.scrollDepth)
	const durationMs = duration(raw.durationMs)
	const device = classifyDevice(ua)
	const browser = classifyBrowser(ua)
	const os = classifyOs(ua)
	const language = primaryLanguage(headers.get('accept-language'))
	const refHost = referrerHost(raw.referrer, hostname, siblings)
	const siteReferrer =
		!isSiteReferral(raw.referrer, hostname) && isSiteReferral(raw.referrer, hostname, siblings)
	const query = queryString(raw.query)
	const utm = extractUtm(query)
	const clickId = clickIdOf(query)
	return {
		timestamp: now,
		type: raw.type,
		name,
		path,
		hostname,
		referrer: storedReferrer(raw.referrer),
		...(refHost ? { referrerHost: refHost } : {}),
		...(siteReferrer ? { siteReferrer: true } : {}),
		...(device ? { device } : {}),
		...(browser ? { browser } : {}),
		...(os ? { os } : {}),
		...utm,
		country: geoValue(geo.country),
		...(anonymous ? {} : { region: geoValue(geo.region), city: geoValue(geo.city) }),
		...(language ? { language } : {}),
		props,
		...(durationMs !== undefined ? { durationMs } : {}),
		...(money.value !== undefined ? { value: money.value } : {}),
		...(money.currency !== undefined ? { currency: money.currency } : {}),
		...(money.originalValue !== undefined ? { originalValue: money.originalValue } : {}),
		...(money.originalCurrency !== undefined ? { originalCurrency: money.originalCurrency } : {}),
		...(order
			? {
					dedupeKey: dedupeKeyFor({
						origin,
						...(scope ? { tenant: scope } : {}),
						goal: name ?? raw.type,
						orderId: order,
						refund,
						...(refundId === undefined ? {} : { refundId }),
						...(orderKey ? { key: orderKey } : {}),
					}),
				}
			: {}),
		...(refund ? { refund: true } : {}),
		...(scrollDepth !== undefined ? { scrollDepth } : {}),
		...(completions.length > 0 ? { goals: completions } : {}),
		...(scope !== undefined ? { scope } : {}),
		...(item !== undefined ? { item } : {}),
		...(impressions.length > 0 ? { impressions } : {}),
		visitorId:
			!anonymous && identifiesVisitor(ip, ua)
				? dailyVisitorId({ ip, ua, site: hostname, salt })
				: '',
		...(clickId ? { clickId } : {}),
		...(input.type === 'pageview' && isNavigation(input.nav) ? { navigation: true } : {}),
		...(origin === 'server' ? { server: true } : {}),
		mode,
	}
}
