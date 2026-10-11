import { createLocalReq, type Payload, type PayloadRequest } from 'payload'
import { captureRequest } from '../../capture/captureRequest'
import { warnUntrustedForwarding } from '../../capture/requestTrust'
import { gateHoldsAdapter } from '../../capture/slots'
import { currentDate } from '../../core/clock'
import type { AnalyticsAdapter } from '../../core/contract'
import {
	AnalyticsTrackError,
	type ServerEventInput,
	type ServerTrack,
	type ServerTrackIdentity,
	type ServerTrackOptions,
} from '../../core/serverEvent'
import { kindOf } from '../../core/values'
import { openTransactionOf } from '../../db/openTransaction'
import { getRuntime } from '../../plugin/runtime'
import { DEFAULT_TIMEZONE } from '../../timeframe/tz'
import { type NativeEngine, SERVER_CLOCK_SKEW_MS } from '../engine/engine'
import { type DailySalts, saltForHit } from '../engine/salt'
import type { SiteHosts } from '../engine/siteHosts'
import { toHit } from '../engine/toHit'
import type { HitWriter } from '../engine/writeBuffer'
import type { GeoResolver } from '../geo/geoResolver'
import { orderHitId, wireTwinOf } from '../store/ids'
import { type ClientIpOptions, overlayClientIp } from './clientIp'
import { SERVER_USER_AGENT } from './device'
import type { IngestAttribution, IngestResolvers } from './endpoint'
import { type ItemIngestOptions, normalizeEvent } from './normalizeEvent'
import { referrerHost } from './referrer'
import {
	dedupeKeyFor,
	isRefund,
	MAX_ORDER_ID_LENGTH,
	orderDigestKey,
	sanitizeOrderId,
	warnUnconvertedOnce,
	warnUnmatchedRevenueGoal,
} from './revenue'
import { rawEventError } from './validate'

/** A warning each instance logs once, so a busy webhook says it once. */
const warningOncePer = (message: string): ((payload: Payload) => void) => {
	const warned = new WeakSet<Payload>()
	return (payload) => {
		if (warned.has(payload)) {
			return
		}
		warned.add(payload)
		payload.logger?.warn(message)
	}
}

const warnUnresolvedZone = warningOncePer(
	'analytics: trackServerEvent hashes visitors by the UTC day for a scope whose reportingTimezone has never resolved: the resolver throws or answers something that is not an IANA timezone. Check that resolver, or pass event.timezone. Logged once.'
)

/** Ids of a sale's browser and server records, which a refund of it looks up. */
const saleRecordsOf = (sale: {
	scope: string | undefined
	goal: string
	orderId: string
	key: Buffer | undefined
}): { wire: string; server: string } => {
	const parts = {
		...(sale.scope ? { tenant: sale.scope } : {}),
		goal: sale.goal,
		orderId: sale.orderId,
		...(sale.key ? { key: sale.key } : {}),
	}
	return {
		wire: orderHitId(dedupeKeyFor({ origin: 'wire', ...parts })),
		server: orderHitId(dedupeKeyFor({ origin: 'server', ...parts })),
	}
}

const isIdentity = (value: unknown): value is ServerTrackIdentity =>
	value === 'request' || value === 'none'

/**
 * The identity of a call that names none: no visitor's while `capture.gate` holds a slot the
 * native beacon may fill, since the server cannot know the visitor's answer; else the request's.
 */
const defaultIdentity = (payload: Payload): ServerTrackIdentity => {
	const runtime = getRuntime(payload)
	const adapter = ingestAdapter(payload)
	if (!runtime || !adapter) {
		return 'request'
	}
	const kind = adapter.capture?.client.kind ?? 'native'
	return gateHoldsAdapter(runtime, adapter.id, kind) ? 'none' : 'request'
}

/** An explicit `ip` or `userAgent` that the gated default set aside. */
const warnIgnoredVisitor = warningOncePer(
	"analytics: trackServerEvent was given an ip or a userAgent but no identity, and capture.gate holds the native slot, so the event is recorded as no visitor's. Pass identity: 'request' where you know the visitor's answer allows it. Logged once."
)

/**
 * A scoped sale with neither `scope` nor `req` is filed under no tenant. Warned, never thrown: a
 * platform may record its own sales under the null scope on purpose.
 */
const warnUnscopedSale = warningOncePer(
	"analytics: purchase or refund was called on a scoped install with neither scope nor req, so the sale is filed under the null scope: no tenant reports it, and the browser's record of the order never meets it. Pass scope (the tenant) or req. Logged once."
)

/** What one Payload instance stores a server event's hit through. */
export interface ServerTrackTarget {
	salts: Pick<DailySalts, 'forHit' | 'forDay'>
	writer: Pick<HitWriter, 'write' | 'defer'>
	items?: ItemIngestOptions
	/** SQLite's single writer: a hit recorded inside an open host transaction waits for it. */
	sqlite: boolean
	/** Asks for maintenance in the background after a hit; it never waits for it. */
	nudge?: () => void
	/**
	 * Refuses hits at or before the raw floor day, recounts a closed day a hit lands on, and says
	 * where a refund's sale counts so the refund is filed beside it.
	 */
	engine?: Pick<NativeEngine, 'serverHitDay' | 'reopen' | 'orderStored' | 'saleAttribution'>
	/** The hostnames each scope records hits under; absent, only the event's own is the site's. */
	siteHosts?: SiteHosts
}

interface ServerTrackDeps {
	geoResolver: GeoResolver
	/** The salts, writer and items of the instance an event is recorded on. */
	target: (payload: Payload) => ServerTrackTarget
	/** Read late: the register context that carries them arrives after the adapter is built. */
	getResolvers: () => IngestResolvers
	/** Read late for the same reason: the plugin option arrives with the register context. */
	getAttribution: () => IngestAttribution
}

/**
 * The originating request's headers, so a server event attributes like its browser twin; `ip` and
 * `userAgent` override them. With neither, or `identity: 'none'`, the server agent stands in.
 */
const attributionHeaders = (
	event: ServerEventInput,
	trust: ClientIpOptions,
	behind: { identity: ServerTrackIdentity; req: PayloadRequest | undefined }
): Headers => {
	const { identity, req } = behind
	if (identity === 'none') {
		return new Headers({ 'user-agent': SERVER_USER_AGENT })
	}
	const own = new Headers(req?.headers)
	const headers = event.ip ? overlayClientIp(own, event.ip, trust) : own
	if (event.userAgent) {
		headers.set('user-agent', event.userAgent)
	}
	if (!headers.get('user-agent')) {
		headers.set('user-agent', SERVER_USER_AGENT)
	}
	return headers
}

/**
 * The caller's scope, else the request's resolved without the signed-in user or cookies, so an
 * editor's sale is filed under the site it happened on.
 */
const resolveScope = async (
	event: ServerEventInput,
	opts: ServerTrackOptions | undefined,
	resolvers: IngestResolvers
): Promise<string | undefined> => {
	// An unscoped install has no scope resolver and no scope field on its rows, so a scope
	// declared by the caller is ignored exactly as the endpoint ignores one on the wire.
	if (!resolvers.scope) {
		return undefined
	}
	if (event.scope !== undefined) {
		return event.scope ?? ''
	}
	if (!opts?.req) {
		return ''
	}
	return (await resolvers.scope(captureRequest(opts.req))) ?? ''
}

/**
 * `adapter.ingest.track`: the endpoint's write path, outside any caller transaction. On SQLite a
 * call inside an open transaction resolves at once and stores its hit when that transaction ends.
 */
export const makeServerTrack =
	(deps: ServerTrackDeps): ServerTrack =>
	async (payload, event, opts) => {
		// Trusted server code: it supplies its own hostname, so the resolver the HTTP endpoint
		// runs is bypassed and the hostname stays required here.
		const invalid = rawEventError(event, { allowRevenue: true, requireHostname: true })
		if (invalid) {
			throw new AnalyticsTrackError(`analytics: trackServerEvent needs a valid "${invalid}"`)
		}
		// Refused rather than dropped: a sale stored without its key would count again on every retry.
		if (event.orderId !== undefined && sanitizeOrderId(event.orderId) === undefined) {
			throw new AnalyticsTrackError(
				`analytics: trackServerEvent needs a valid "orderId": a string of 1 to ${MAX_ORDER_ID_LENGTH} characters without control characters, so a retried order counts once`
			)
		}
		if (
			isRefund(event.revenue === true, event.value) &&
			sanitizeOrderId(event.orderId) !== undefined &&
			sanitizeOrderId(event.refundId) === undefined
		) {
			throw new AnalyticsTrackError(
				'analytics: trackServerEvent needs a valid "refundId" on a refund of an order: the refund\'s own id, so each partial refund counts once'
			)
		}
		// Refused rather than read as the default: a misspelt 'none' must not attribute the visitor.
		if (opts?.identity !== undefined && !isIdentity(opts.identity)) {
			throw new AnalyticsTrackError(
				`analytics: trackServerEvent's identity must be 'request' or 'none', got ${kindOf(opts.identity)}`
			)
		}
		if (
			event.now !== undefined &&
			!(event.now instanceof Date && Number.isFinite(event.now.getTime()))
		) {
			throw new AnalyticsTrackError('analytics: trackServerEvent needs a valid "now"')
		}
		const identity = opts?.identity ?? defaultIdentity(payload)
		if (opts?.identity === undefined && identity === 'none' && (event.ip || event.userAgent)) {
			warnIgnoredVisitor(payload)
		}
		const receivedAt = currentDate()
		const now = event.now ?? receivedAt
		if (now.getTime() > receivedAt.getTime() + SERVER_CLOCK_SKEW_MS) {
			throw new AnalyticsTrackError(
				`analytics: trackServerEvent's "now" (${now.toISOString()}) is more than ${SERVER_CLOCK_SKEW_MS / 60_000} minutes ahead of the server's clock`
			)
		}
		const target = deps.target(payload)
		if (
			event.revenue === true &&
			event.scope === undefined &&
			!opts?.req &&
			deps.getResolvers().scope
		) {
			warnUnscopedSale(payload)
		}

		const record = async (): Promise<void> => {
			const resolvers = deps.getResolvers()
			const scope = await resolveScope(event, opts, resolvers)
			// Refused before anything is written: a day whose raw hits may be pruned is never counted.
			const placed = await target.engine?.serverHitDay(scope ?? '', now)
			// createLocalReq mutates its request, so a caller's req never reaches it: resolvers see it
			// as a capture does, without the user or cookies, and a fresh one is built only on demand.
			let local: PayloadRequest | undefined
			const requestFor = async (): Promise<PayloadRequest> => {
				if (opts?.req) {
					return captureRequest(opts.req)
				}
				local ??= await createLocalReq({}, payload)
				return local
			}
			const salt = await saltForHit(
				target.salts,
				{
					scope: scope ?? '',
					at: now,
					zone: async () =>
						event.timezone ??
						(resolvers.timezone
							? resolvers.timezone(await requestFor(), scope ?? null)
							: DEFAULT_TIMEZONE),
				},
				() => warnUnresolvedZone(payload)
			)
			// Goals resolve under the scope the event is stamped with, so a tenant's server event
			// can only ever complete that tenant's goals.
			const goals = resolvers.goals
				? await resolvers.goals(await requestFor(), scope ?? null)
				: undefined
			const reportingCurrency = resolvers.currency
				? await resolvers.currency(await requestFor(), scope ?? null)
				: undefined
			const attribution = deps.getAttribution()
			const orderKey = orderDigestKey(payload.secret)
			const trust: ClientIpOptions = {
				trustedProxyHops: attribution.trustedProxyHops,
				trustedPlatform: attribution.trustedPlatform,
			}
			if (opts?.req && !event.ip && identity !== 'none') {
				warnUntrustedForwarding(payload, opts.req.headers, trust)
			}
			const siblings =
				target.siteHosts &&
				event.type === 'pageview' &&
				referrerHost(event.referrer, event.hostname) !== undefined
					? await target.siteHosts.of(scope ?? '')
					: undefined
			const normalized = await normalizeEvent({
				raw: {
					type: event.type,
					name: event.name,
					path: event.path,
					referrer: event.referrer,
					query: event.query,
					props: event.props,
					value: event.value,
					currency: event.currency,
					items: event.items,
					revenue: event.revenue,
					orderId: event.orderId,
					refundId: event.refundId,
					item: event.item,
				},
				hostname: event.hostname,
				headers: attributionHeaders(event, trust, { identity, req: opts?.req }),
				geoResolver: deps.geoResolver,
				warnGeo: (message) => payload.logger?.warn(message),
				salt,
				now,
				scope,
				goals,
				origin: 'server',
				reportingCurrency,
				convertCurrency: resolvers.convertCurrency,
				warnUnconverted: () => warnUnconvertedOnce(payload.logger),
				...trust,
				...(target.items ? { items: target.items } : {}),
				...(siblings ? { siblings } : {}),
				orderKey,
			})
			// Only the server path can reach this: a public beacon's caller must never be able to
			// write lines into the host's log.
			if (event.revenue === true && normalized.goals === undefined) {
				warnUnmatchedRevenueGoal(payload.logger, event.name ?? event.type)
			}
			// An order bypasses the buffer and meets its own primary key: a retry stores nothing. A hit
			// on a closed day is stored before its day is reopened, so the count after it holds it.
			const late = placed?.closed === true
			const counted = toHit(normalized, { receivedAt })
			const orderId = sanitizeOrderId(event.orderId)
			// A refund with no visitor of its own is filed where its sale counts, so every breakdown
			// still sums to the total.
			const hit =
				normalized.refund && counted.v === '' && orderId !== undefined && target.engine
					? {
							...counted,
							...(await target.engine.saleAttribution(
								scope ?? '',
								saleRecordsOf({
									scope,
									goal: normalized.name ?? normalized.type,
									orderId,
									key: orderKey,
								})
							)),
						}
					: counted
			const stored = await target.writer.write(hit, {
				...(opts?.flush || late ? { flush: true } : {}),
			})
			target.siteHosts?.saw(scope ?? '', normalized.hostname)
			// A retried order stores nothing, so it counts no day again.
			const fresh = stored === undefined || stored.written > 0
			if (placed && late && fresh) {
				await target.engine?.reopen(placed)
			}
			if (wireTwinOf(hit.id) !== undefined && !normalized.refund && fresh) {
				await target.engine?.orderStored(scope ?? '', hit.id)
			}
		}

		// The host holds SQLite's one write lock until its transaction ends, and a write that waited
		// for it here would wait on the very caller it is part of.
		const open = target.sqlite ? await openTransactionOf(payload, opts?.req) : undefined
		if (open) {
			target.writer.defer(record, open)
			return
		}
		await record()
		target.nudge?.()
	}

/**
 * First registered adapter with a server ingestion seam. Callers read every other seam off it too,
 * so an event cannot be judged by one adapter and written by another.
 */
export const ingestAdapter = (payload: Payload): AnalyticsAdapter | undefined =>
	getRuntime(payload)
		?.registry.all()
		.find((adapter) => adapter.ingest?.track)

/**
 * Records an event from server code through the native adapter, normalized as a beacon is. Without
 * `opts.identity` it is no visitor's while `capture.gate` holds the native slot.
 */
export const trackServerEvent = async (
	payload: Payload,
	event: ServerEventInput,
	opts?: ServerTrackOptions
): Promise<void> => {
	const track = ingestAdapter(payload)?.ingest?.track
	if (!track) {
		throw new AnalyticsTrackError(
			'analytics: trackServerEvent needs the native adapter; provider-slot server tracking is not supported yet'
		)
	}
	await track(payload, event, opts)
}
