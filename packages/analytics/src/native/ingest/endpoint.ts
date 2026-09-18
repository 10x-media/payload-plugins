import type { PayloadHandler, PayloadRequest } from 'payload'
import { readCappedBody } from '../../capture/requestBody'
import type { Goal } from '../../goals/types'
import { analyticsError, errorResponse } from '../../plugin/errors'
import type { GeoResolver } from '../geo/geoResolver'
import { type BotFilter, isBot } from './bots'
import { flushBatch } from './flushBatch'
import { normalizeEvent, type RawEventInput, type StoredEvent } from './normalizeEvent'
import { type ResolvedHostnameOption, resolveEventHostname } from './resolveHostname'
import { dailySalt } from './salt'
import { type RawEventField, rawEventError } from './validate'
import type { WriteBuffer } from './writeBuffer'

export interface IngestResolvers {
	scope?: (req: PayloadRequest) => Promise<string | null>
	timezone?: (req: PayloadRequest, scope?: string | null) => Promise<string>
	goals?: (req: PayloadRequest, scope?: string | null) => Promise<Goal[]>
}

/** How the handler reads the request behind an event, as opposed to what the body claims. */
export interface IngestAttribution {
	trustedProxyHops?: number
	/** Resolved `hostname` option; absent attributes the event to the request's own host. */
	hostname?: ResolvedHostnameOption
	/** Hostnames that ingest on a scoped install even when the request resolves no scope. */
	platformHostnames?: ReadonlySet<string>
}

/**
 * What an accepted beacon answers, and what a dropped one answers too: same status, same body,
 * no header of its own and nothing logged per event, so the endpoint never tells a prober which
 * hosts or tenants exist.
 */
const accepted = (): Response => Response.json({ ok: true }, { status: 202 })

const REQUEST_HOSTNAME: ResolvedHostnameOption = { kind: 'request' }

/**
 * What an operator has to hear about once, and the line that tells them where to look. A
 * misconfigured resolver, a broken filter or a header-stripping proxy otherwise costs an
 * install its traffic in silence, since the response cannot say any of it.
 */
const WARN_REASONS = {
	'no scope resolved':
		'analytics: ingest is dropping events because scopeResolver answered no scope for them. Check that resolver, and list any platform domain in platformHostnames so it ingests under the null scope. Logged once per process.',
	'hostname refused':
		'analytics: ingest is dropping events because the hostname option refused the request host. Check that option, and platformHostnames for a platform domain. Logged once per process.',
	'bot filter threw':
		'analytics: the filterBots function threw, so the event was kept. Check that function; every beacon counts while it throws. Logged once per process.',
	'no user agent':
		'analytics: a beacon arrived with no user agent and was not recorded: an intermediary may be stripping the header. Logged once per process.',
} as const

type WarnReason = keyof typeof WARN_REASONS

/** One event, not a session replay: far above any legitimate payload, far below a DoS. */
export const MAX_INGEST_BODY_BYTES = 64 * 1024

/**
 * Parses the buffered body, answering undefined for anything the validator could not judge:
 * a garbage POST is a 400 like any other bad payload rather than a thrown parse error that
 * escapes into Payload's routeError as a logged 500.
 */
const parseBody = (bytes: ArrayBuffer): RawEventInput | undefined => {
	try {
		const parsed: unknown = JSON.parse(new TextDecoder().decode(bytes))
		return typeof parsed === 'object' && parsed !== null ? (parsed as RawEventInput) : undefined
	} catch {
		return undefined
	}
}

/**
 * The refusal for the first field an event failed on: naming it costs nothing and saves a
 * tracker author guessing which one of four the endpoint refused. A body that is not an
 * object at all fails the very check a typeless event does, so it names `type`.
 */
const invalidField = (param: RawEventField): Response =>
	errorResponse(
		400,
		analyticsError('invalid_param', `analytics: ${param} is missing or invalid`, param)
	)

export interface IngestHandlerOptions {
	geoResolver: GeoResolver
	getBuffer?: () => WriteBuffer<StoredEvent> | null
	resolvers?: IngestResolvers
	attribution?: IngestAttribution
	/** Which agents never reach the pipeline. Defaults to the built-in `isBot`. */
	filterBots?: BotFilter
}

export const makeIngestHandler = ({
	geoResolver,
	getBuffer = () => null,
	resolvers = {},
	attribution = {},
	filterBots = isBot,
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

	return async (req) => {
		// First, before the body is even read, so a crawler costs one header lookup. Its beacon
		// is answered exactly like a kept one and nothing is logged: bots are expected traffic
		// rather than a misconfiguration an operator has to hear about once per process.
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
		const { scope: resolveScope, timezone: resolveTimezone, goals: resolveGoals } = resolvers
		// Read like the capture proxy does, and for the same reasons: this is a public,
		// unauthenticated path, so the body is capped before it is buffered and a body that
		// dies in transit (a beacon from an unloading tab) answers 400 rather than throwing.
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
		const now = new Date()
		const resolvedScope = resolveScope ? await resolveScope(req) : null
		const scope = resolveScope ? (resolvedScope ?? '') : undefined
		const hostname = await resolveEventHostname({
			option: attribution.hostname ?? REQUEST_HOSTNAME,
			claimed: raw.hostname,
			req,
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
		const salt = await dailySalt(req.payload, now)
		const timezone = resolveTimezone ? await resolveTimezone(req, scope ?? null) : undefined
		// Goals resolve under the same scope the event is stamped with, so a tenant's event
		// can only ever complete that tenant's goals.
		const goals = resolveGoals ? await resolveGoals(req, scope ?? null) : undefined
		const event = await normalizeEvent({
			raw,
			hostname,
			headers: req.headers,
			geoResolver,
			salt,
			now,
			scope,
			timezone,
			goals,
			trustedProxyHops: attribution.trustedProxyHops,
		})
		const buffer = getBuffer()
		if (buffer) {
			buffer.add(event)
		} else {
			await flushBatch(req.payload, [event])
		}
		return accepted()
	}
}
