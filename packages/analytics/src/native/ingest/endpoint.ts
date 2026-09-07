import type { PayloadHandler, PayloadRequest } from 'payload'
import { readCappedBody } from '../../capture/requestBody'
import type { Goal } from '../../goals/types'
import type { GeoResolver } from '../geo/geoResolver'
import { flushBatch } from './flushBatch'
import {
	type EventType,
	normalizeEvent,
	type RawEventInput,
	type StoredEvent,
} from './normalizeEvent'
import { dailySalt } from './salt'
import type { WriteBuffer } from './writeBuffer'

export interface IngestResolvers {
	scope?: (req: PayloadRequest) => Promise<string | null>
	timezone?: (req: PayloadRequest, scope?: string | null) => Promise<string>
	goals?: (req: PayloadRequest, scope?: string | null) => Promise<Goal[]>
}

const TYPES: ReadonlySet<string> = new Set<EventType>(['pageview', 'event', 'goal'])

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
 * An event is rejected only on its required fields: a known `type`, a `path`, a `hostname`,
 * and a `name` (the event name, or the goal slug on a `goal`) for everything but a pageview.
 * Optional fields are sanitized in `normalizeEvent` and dropped when malformed, so one bad
 * attribute costs an attribute rather than the whole event.
 */
const nonEmptyString = (value: unknown): boolean => typeof value === 'string' && value.length > 0

const isValid = (raw: RawEventInput | undefined): raw is RawEventInput => {
	// Types are checked, not just truthiness: a non-string path would otherwise reach goal
	// matching and throw there rather than answering 400 here.
	if (!raw || !TYPES.has(raw.type) || !nonEmptyString(raw.path) || !nonEmptyString(raw.hostname)) {
		return false
	}
	return raw.type === 'pageview' || nonEmptyString(raw.name)
}

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
			return Response.json(
				{ error: read.reason === 'too-large' ? 'payload too large' : 'invalid payload' },
				{ status: read.reason === 'too-large' ? 413 : 400 }
			)
		}
		const raw = parseBody(read.body)
		if (!isValid(raw)) {
			return Response.json({ error: 'invalid payload' }, { status: 400 })
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
