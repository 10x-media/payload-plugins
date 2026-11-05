import type { Payload, PayloadHandler, PayloadRequest } from 'payload'
import { captureRequest } from '../../capture/captureRequest'
import { readCappedBody } from '../../capture/requestBody'
import { refusedCrossSite, warnUntrustedForwarding } from '../../capture/requestTrust'
import { refusedSameSite } from '../../capture/sameSite'
import { currentDate } from '../../core/clock'
import { monotonicMs } from '../../core/monotonic'
import type { CurrencyConverter } from '../../goals/currency'
import { type BrowserAmounts, DEFAULT_BROWSER_AMOUNTS } from '../../goals/match'
import type { Goal } from '../../goals/types'
import type { TrustedPlatform } from '../../net/platform'
import { analyticsError, errorResponse } from '../../plugin/errors'
import { DEFAULT_TIMEZONE } from '../../timeframe/tz'
import type { NativeEngine } from '../engine/engine'
import { type DailySalts, saltForHit } from '../engine/salt'
import type { SiteHosts } from '../engine/siteHosts'
import { toHit } from '../engine/toHit'
import type { HitWriter } from '../engine/writeBuffer'
import type { GeoResolver } from '../geo/geoResolver'
import { serverTwinOf } from '../store/ids'
import type { AppendResult } from '../store/types'
import { type BotFilter, isBot } from './bots'
import {
	eventTime,
	type ItemIngestOptions,
	normalizeEvent,
	type RawEventInput,
} from './normalizeEvent'
import { type OrderSignatureCheck, wireOrderId } from './orderSignature'
import { referrerHost } from './referrer'
import { type ResolvedHostnameOption, resolveEventHostname } from './resolveHostname'
import { orderDigestKey, warnUnconvertedOnce } from './revenue'
import { type RawEventField, rawEventError } from './validate'

export interface IngestResolvers {
	/** `scope.resolve` at the `capture` call site. */
	scope?: (req: PayloadRequest) => Promise<string | null>
	/**
	 * Reporting timezone, which picks the day whose salt hashes the visitor. Throws rather than
	 * answer UTC when the host resolver fails; the scope's last good zone then stands in.
	 */
	timezone?: (req: PayloadRequest, scope?: string | null) => Promise<string>
	currency?: (req: PayloadRequest, scope?: string | null) => Promise<string | undefined>
	convertCurrency?: CurrencyConverter
	goals?: (req: PayloadRequest, scope?: string | null) => Promise<Goal[]>
	/**
	 * Whether the scope's provider documents grant it the native engine; answered from the registry
	 * cache, so it costs no query per beacon.
	 */
	granted?: (req: PayloadRequest, scope: string | null) => Promise<boolean>
}

/** How the handler reads the request behind an event, as opposed to what the body claims. */
export interface IngestAttribution {
	trustedProxyHops?: number
	/** The platform whose edge headers carry the visitor's address and location. */
	trustedPlatform?: TrustedPlatform
	/**
	 * `capture.allowedOrigins`, normalized: the other sites whose pages may send beacons here.
	 * Absent, every beacon a browser marks `Sec-Fetch-Site: cross-site` is dropped.
	 */
	allowedOrigins?: ReadonlySet<string>
	/** Resolved `hostname` option; absent attributes the event to the request's own host. */
	hostname?: ResolvedHostnameOption
	/** Hostnames that ingest on a scoped install even when the request resolves no scope. */
	platformHostnames?: ReadonlySet<string>
}

/** What one Payload instance stores a beacon's hit through. */
export interface IngestTarget {
	salts: Pick<DailySalts, 'forHit' | 'forDay'>
	writer: Pick<HitWriter, 'write'>
	/** The collections bound as items; absent, every item ref a beacon carries is dropped. */
	items?: ItemIngestOptions
	/** Asks for maintenance in the background after a hit; it never waits for it. */
	nudge?: () => void
	/** The hostnames each scope records hits under; absent, only the event's own is the site's. */
	siteHosts?: SiteHosts
	/**
	 * Told when a browser record of an order is stored, so a closed day holding the server's record
	 * of that sale is counted again: the sale now counts on the browser's record.
	 */
	engine?: Pick<NativeEngine, 'orderStored'>
	/** How an order id a page sends is checked; absent, no signature can be. */
	orders?: OrderSignatureCheck
	/** Keeps work running past the response that started it (Next's `after()`). */
	keepAlive?: (work: Promise<unknown>) => void
}

/**
 * Dropped beacons answer exactly like accepted ones, with nothing logged per event, so the endpoint
 * never tells a prober which hosts or tenants exist.
 */
const accepted = (): Response => Response.json({ ok: true }, { status: 202 })

const REQUEST_HOSTNAME: ResolvedHostnameOption = { kind: 'request' }

const NO_ORIGINS: ReadonlySet<string> = new Set()

/**
 * Logged once each: a misconfigured resolver, broken filter or header-stripping proxy otherwise
 * costs an install its traffic in silence, since the response cannot say so.
 */
const WARN_REASONS = {
	'no scope resolved':
		'analytics: ingest is dropping events because scope.resolve answered no scope for them. Check that resolver, and list any platform domain in platformHostnames so it ingests under the null scope. Logged once per process.',
	'no native provider':
		'analytics: ingest is dropping events for a scope with no enabled native provider document. Add one for that tenant to store its visits here. Logged once per process.',
	'hostname refused':
		'analytics: ingest is dropping events because the hostname option refused the request host. Check that option, and platformHostnames for a platform domain. Logged once per process.',
	'bot filter threw':
		'analytics: the filterBots function threw, so the event was kept. Check that function; every beacon counts while it throws. Logged once per process.',
	'no user agent':
		'analytics: a beacon arrived with no user agent and was not recorded: an intermediary may be stripping the header. Logged once per process.',
	'cross-site':
		"analytics: ingest is dropping beacons that a page on another site made a visitor's browser send (Sec-Fetch-Site: cross-site). If a site on another domain should send its visits here, list its origin in capture.allowedOrigins. Logged once per process.",
	'other scope':
		"analytics: ingest is dropping beacons that a page on a sibling subdomain sent (Sec-Fetch-Site: same-site) whose Origin scope.resolve maps to another scope than the request's. Each tenant's pages post to their own host. Logged once per process.",
	'timezone unresolved':
		'analytics: ingest hashes visitors by the UTC day for a scope whose reportingTimezone has never resolved: the resolver throws or answers something that is not an IANA timezone. Check that resolver. Logged once per process.',
	'order recount failed':
		"analytics: a browser's record of an order was stored, but the closed day holding the server's record of it could not be marked to be counted again, so that day keeps the sale until it is rebuilt. Logged once per process.",
	'order refused':
		'analytics: ingest is dropping sales whose orderId is empty, too long, holds a control character, or lacks the signature signOrderId writes while signatures are required. Logged once per process.',
} as const

type WarnReason = keyof typeof WARN_REASONS

/** One line about failed beacons at most this often: a public path must not be a log amplifier. */
const FAILED_LOG_MS = 60_000

export type BeaconFailureLog = (payload: Payload, err: unknown) => void

/** Counts beacons that could not be `what` and logs them in one line at most once a minute. */
export const beaconFailureLog = (what: 'stored' | 'taken'): BeaconFailureLog => {
	let failed = 0
	let loggedAt: number | null = null
	return (payload, err) => {
		failed += 1
		const at = monotonicMs()
		if (loggedAt !== null && at - loggedAt < FAILED_LOG_MS) {
			return
		}
		loggedAt = at
		payload.logger?.error({
			err,
			msg: `analytics: ${failed} beacons could not be ${what}. Logged at most once a minute.`,
		})
		failed = 0
	}
}

/** One event, not a session replay: far above any legitimate payload, far below a DoS. */
const MAX_INGEST_BODY_BYTES = 64 * 1024

/**
 * Undefined for anything unparseable, so a garbage POST is a 400 rather than a thrown error that
 * escapes into Payload's routeError as a logged 500.
 */
const parseBody = (bytes: ArrayBuffer): RawEventInput | undefined => {
	try {
		const parsed: unknown = JSON.parse(new TextDecoder().decode(bytes))
		// Unchecked until `rawEventError` runs; every field it skips is sanitized as unknown later.
		return typeof parsed === 'object' && parsed !== null ? (parsed as RawEventInput) : undefined
	} catch {
		return undefined
	}
}

/**
 * Naming the failed field saves a tracker author guessing. A non-object body fails the same check
 * a typeless event does, so it names `type`.
 */
const invalidField = (param: RawEventField): Response =>
	errorResponse(
		400,
		analyticsError('invalid_param', `analytics: ${param} is missing or invalid`, param)
	)

export interface IngestHandlerOptions {
	geoResolver: GeoResolver
	/** The salts, writer and items of the instance a beacon reached. */
	target: (payload: Payload) => IngestTarget
	resolvers?: IngestResolvers
	attribution?: IngestAttribution
	/** Which agents never reach the pipeline. Defaults to the built-in `isBot`. */
	filterBots?: BotFilter
	/** `revenue.browserAmounts`: how far a beacon's amount is believed. Default `'fixed'`. */
	browserAmounts?: BrowserAmounts
}

/**
 * Native beacon endpoint: cheap refusals first, then everything resolved as a capture call site
 * sees the request. The only read on the public path is the day's salt, once a day per process.
 */
export const makeIngestHandler = ({
	geoResolver,
	target,
	resolvers = {},
	attribution = {},
	filterBots = isBot,
	browserAmounts = DEFAULT_BROWSER_AMOUNTS,
}: IngestHandlerOptions): PayloadHandler => {
	// One line per reason for the life of the handler, which is the life of the process: a
	// public endpoint must not be a log amplifier, and an attacker chooses how often it drops.
	const warned = new Set<WarnReason>()
	const warnOnce = (req: PayloadRequest, reason: WarnReason): void => {
		if (!warned.has(reason)) {
			warned.add(reason)
			req.payload.logger?.warn(WARN_REASONS[reason])
		}
	}
	const drop = (req: PayloadRequest, reason: WarnReason): Response => {
		warnOnce(req, reason)
		return accepted()
	}
	const writeFailed = beaconFailureLog('stored')
	const takeFailed = beaconFailureLog('taken')

	const take = async (req: PayloadRequest): Promise<Response> => {
		// Before the body is read, so a crawler costs one header lookup; answered like a kept beacon
		// and never logged, since bots are expected traffic.
		const userAgent = req.headers.get('user-agent') ?? ''
		let automated = false
		try {
			automated = filterBots(userAgent)
		} catch {
			warnOnce(req, 'bot filter threw')
		}
		if (automated) {
			// The exception to the silence: an agent-less beacon is indistinguishable from an
			// intermediary stripping the header, which would zero an install's numbers.
			if (userAgent.trim() === '') {
				warnOnce(req, 'no user agent')
			}
			return accepted()
		}
		// Another site's page cannot make its visitors count here: the browser says where the
		// request came from, and only a listed origin may send from elsewhere.
		if (refusedCrossSite(req.headers, attribution.allowedOrigins ?? NO_ORIGINS)) {
			return drop(req, 'cross-site')
		}
		const {
			scope: resolveScope,
			timezone: resolveTimezone,
			currency: resolveCurrency,
			goals: resolveGoals,
		} = resolvers
		// A public path: the body is capped before it is buffered, and one that dies in transit (an
		// unloading tab's beacon) answers 400 rather than throwing.
		const read = await readCappedBody(req, MAX_INGEST_BODY_BYTES)
		if (!read.ok) {
			return read.reason === 'too-large'
				? errorResponse(
						413,
						analyticsError('payload_too_large', 'analytics: the event body is too large')
					)
				: errorResponse(
						400,
						analyticsError('invalid_param', 'analytics: the event body could not be read')
					)
		}
		const raw = parseBody(read.body)
		if (raw === undefined) {
			return invalidField('type')
		}
		const param = rawEventError(raw)
		if (param !== undefined) {
			return invalidField(param)
		}
		const mode = raw.m ?? 'f'
		// Anonymous time and scroll are never stored, so the beacon that carries them costs no more.
		if (mode === 'a' && raw.type === 'engagement') {
			return accepted()
		}
		const receivedAt = currentDate()
		const at = eventTime(raw, receivedAt)
		// The host's resolvers are asked about the visit, never the signed-in editor whose session
		// a beacon carries: the tenant is the site it landed on, not the admin's selection.
		const visitor = captureRequest(req)
		const resolvedScope = resolveScope ? await resolveScope(visitor) : null
		const scope = resolveScope ? (resolvedScope ?? '') : undefined
		const hostname = await resolveEventHostname({
			option: attribution.hostname ?? REQUEST_HOSTNAME,
			claimed: raw.hostname,
			req: visitor,
			scope: resolvedScope,
			trustedProxyHops: attribution.trustedProxyHops,
		})
		if (hostname === null) {
			return drop(req, 'hostname refused')
		}
		// A scoped install keeps only what a scope answers for. Its platform hostnames are
		// infrastructure rather than tenants, so they ingest under the null scope.
		const unscoped =
			resolveScope !== undefined &&
			resolvedScope === null &&
			!(attribution.platformHostnames?.has(hostname) ?? false)
		if (unscoped) {
			return drop(req, 'no scope resolved')
		}
		// A sibling subdomain is another tenant's site: its pages cannot count into this one.
		if (
			resolveScope &&
			(await refusedSameSite(visitor, () => Promise.resolve(resolvedScope), resolveScope))
		) {
			return drop(req, 'other scope')
		}
		// A tenant stores visits only while it says so, checked after the hostname and scope rules
		// and answered 202 either way, so a forged host cannot probe which tenants exist.
		if (resolvers.granted && !(await resolvers.granted(visitor, resolvedScope))) {
			return drop(req, 'no native provider')
		}
		const { salts, writer, items, nudge, siteHosts, engine, orders, keepAlive } = target(
			req.payload
		)
		// An order id no key can be stored under is dropped rather than stored as a sale without one,
		// and answered 202 like any drop: a 400 here would tell a prober the tenant takes beacons.
		const order = wireOrderId(raw.orderId, scope ?? '', orders)
		if (!order.ok) {
			return drop(req, 'order refused')
		}
		// An anonymous hit hashes no visitor, so it needs no salt.
		const salt =
			mode === 'a'
				? ''
				: await saltForHit(
						salts,
						{
							scope: scope ?? '',
							at,
							zone: () =>
								resolveTimezone ? resolveTimezone(visitor, scope ?? null) : DEFAULT_TIMEZONE,
						},
						() => warnOnce(req, 'timezone unresolved')
					)
		// Goals resolve under the same scope the event is stamped with, so a tenant's event
		// can only ever complete that tenant's goals. An engagement completes none.
		const goals =
			resolveGoals && raw.type !== 'engagement'
				? await resolveGoals(visitor, scope ?? null)
				: undefined
		const reportingCurrency = resolveCurrency
			? await resolveCurrency(visitor, scope ?? null)
			: undefined
		const trust = {
			trustedProxyHops: attribution.trustedProxyHops,
			trustedPlatform: attribution.trustedPlatform,
		}
		warnUntrustedForwarding(req.payload, req.headers, trust)
		// Only a pageview from another host needs the scope's hostnames: is it a sibling's page?
		const siblings =
			siteHosts && raw.type === 'pageview' && referrerHost(raw.referrer, hostname) !== undefined
				? await siteHosts.of(scope ?? '')
				: undefined
		const event = await normalizeEvent({
			raw: { ...raw, orderId: order.orderId },
			hostname,
			headers: req.headers,
			geoResolver,
			warnGeo: (message) => req.payload.logger?.warn(message),
			salt,
			now: at,
			scope,
			goals,
			origin: 'wire',
			browserAmounts,
			reportingCurrency,
			convertCurrency: resolvers.convertCurrency,
			warnUnconverted: () => warnUnconvertedOnce(req.payload.logger),
			...trust,
			...(items ? { items } : {}),
			...(siblings ? { siblings } : {}),
			orderKey: orderDigestKey(req.payload?.secret),
			mode,
		})
		// Nothing left to add once sanitized: no time, no scroll and no item seen moves no number.
		if (
			event.type === 'engagement' &&
			!event.durationMs &&
			!event.scrollDepth &&
			!event.impressions?.length
		) {
			return accepted()
		}
		// A retried order meets its own primary key and is refused there; nothing is read first,
		// since a read per beacon on a public path is a query anyone can repeat at will.
		const hit = toHit(event, { receivedAt })
		let stored: AppendResult | undefined
		try {
			stored = await writer.write(hit)
			siteHosts?.saw(scope ?? '', hostname)
		} catch (err) {
			writeFailed(req.payload, err)
		}
		// For an order the write just stored, never a repeat of one: one primary key lookup of the
		// server's record, past the response. Maintenance sweeps the orders again in case it is lost.
		if (engine && (stored?.written ?? 0) > 0 && serverTwinOf(hit.id) !== undefined) {
			const probe = engine
				.orderStored(scope ?? '', hit.id)
				.catch(() => warnOnce(req, 'order recount failed'))
			keepAlive?.(probe)
		}
		nudge?.()
		return accepted()
	}

	return async (req) => {
		try {
			return await take(req)
		} catch (err) {
			// A host resolver or a store failing must not reach Payload's routeError as a logged 500
			// per beacon: a public path answers its own envelope and logs at most once a minute.
			takeFailed(req.payload, err)
			return errorResponse(500, analyticsError('internal', 'analytics: the beacon failed'))
		}
	}
}
