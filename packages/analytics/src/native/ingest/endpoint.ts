import type { PayloadHandler, PayloadRequest } from 'payload'
import { readCappedBody } from '../../capture/requestBody'
import type { Goal } from '../../goals/types'
import { analyticsError, errorResponse } from '../../plugin/errors'
import type { GeoResolver } from '../geo/geoResolver'
import { flushBatch } from './flushBatch'
import { normalizeEvent, type RawEventInput, type StoredEvent } from './normalizeEvent'
import { dailySalt } from './salt'
import { type RawEventField, rawEventError } from './validate'
import type { WriteBuffer } from './writeBuffer'

export interface IngestResolvers {
	scope?: (req: PayloadRequest) => Promise<string | null>
	timezone?: (req: PayloadRequest, scope?: string | null) => Promise<string>
	goals?: (req: PayloadRequest, scope?: string | null) => Promise<Goal[]>
}

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

export const makeIngestHandler =
	(
		geoResolver: GeoResolver,
		getBuffer: () => WriteBuffer<StoredEvent> | null = () => null,
		resolvers: IngestResolvers = {}
	): PayloadHandler =>
	async (req) => {
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
		const salt = await dailySalt(req.payload, now)
		const scope = resolveScope ? ((await resolveScope(req)) ?? '') : undefined
		const timezone = resolveTimezone ? await resolveTimezone(req, scope ?? null) : undefined
		// Goals resolve under the same scope the event is stamped with, so a tenant's event
		// can only ever complete that tenant's goals.
		const goals = resolveGoals ? await resolveGoals(req, scope ?? null) : undefined
		const event = await normalizeEvent({
			raw,
			headers: req.headers,
			geoResolver,
			salt,
			now,
			scope,
			timezone,
			goals,
		})
		const buffer = getBuffer()
		if (buffer) {
			buffer.add(event)
		} else {
			await flushBatch(req.payload, [event])
		}
		return Response.json({ ok: true }, { status: 202 })
	}
