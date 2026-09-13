import { createLocalReq, type Payload, type PayloadRequest } from 'payload'
import { getRuntime } from '../../plugin/runtime'
import type { GeoResolver } from '../geo/geoResolver'
import type { IngestResolvers } from './endpoint'
import { flushBatch } from './flushBatch'
import { type EventType, normalizeEvent, type StoredEvent } from './normalizeEvent'
import { dailySalt } from './salt'
import { rawEventError } from './validate'
import type { WriteBuffer } from './writeBuffer'

/**
 * The user agent an event with no attribution inputs is hashed under. Every such event in a
 * day therefore shares one visitor hash per site, so server-side tracking reports at most
 * one extra unique visitor per day per site rather than inflating the count per call.
 */
export const SERVER_USER_AGENT = 'analytics-server'

export interface ServerEventInput {
	type: EventType
	/** Event name, or the goal slug on a `goal`. Absent on pageviews. */
	name?: string
	path: string
	hostname: string
	referrer?: string
	props?: Record<string, unknown>
	/** Revenue for a goal completion, in `currency`. */
	value?: number
	currency?: string
	/**
	 * Attribution inputs, forwarded from the originating request when there is one. Absent
	 * means the synthetic server visitor, which never inflates uniques beyond one visitor
	 * per day per site. No IP is ever fabricated.
	 */
	ip?: string
	userAgent?: string
	/** Analytics boundary to stamp; null is install-wide. Unset resolves from `opts.req`. */
	scope?: string | null
	/** IANA reporting timezone the rollup day bucket is computed in. */
	timezone?: string
	/** Event time; defaults to now. */
	now?: Date
}

export interface ServerTrackOptions {
	/** The request the event belongs to; its scope and reporting timezone resolve from it. */
	req?: PayloadRequest
}

export type ServerTrack = (event: ServerEventInput, opts?: ServerTrackOptions) => Promise<void>

/** Thrown instead of dropping the event: a server caller can handle a rejected promise. */
export class AnalyticsTrackError extends Error {
	constructor(message: string) {
		super(message)
		this.name = 'AnalyticsTrackError'
	}
}

export interface ServerTrackDeps {
	/** Null until the adapter's onInit has run. */
	getPayload: () => Payload | null
	geoResolver: GeoResolver
	getBuffer: () => WriteBuffer<StoredEvent> | null
	/** Read late: the register context that carries them arrives after the adapter is built. */
	getResolvers: () => IngestResolvers
}

const attributionHeaders = (event: ServerEventInput): Headers => {
	const headers = new Headers({ 'user-agent': event.userAgent ?? SERVER_USER_AGENT })
	if (event.ip) {
		headers.set('x-forwarded-for', event.ip)
	}
	return headers
}

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
	return (await resolvers.scope(opts.req)) ?? ''
}

/**
 * The native adapter's server-side ingestion, exposed as `adapter.ingest.track`. Same
 * normalization, goal matching and write path the HTTP endpoint uses; only attribution and
 * scope resolution differ, since there may be no request behind the event at all.
 */
export const makeServerTrack =
	(deps: ServerTrackDeps): ServerTrack =>
	async (event, opts) => {
		const payload = deps.getPayload()
		if (!payload) {
			throw new AnalyticsTrackError('analytics: trackServerEvent called before init')
		}
		const invalid = rawEventError(event)
		if (invalid) {
			throw new AnalyticsTrackError(`analytics: trackServerEvent needs a valid "${invalid}"`)
		}
		const resolvers = deps.getResolvers()
		const scope = await resolveScope(event, opts, resolvers)
		// createLocalReq mutates the request it is given, so a caller's own req is passed
		// through untouched and a fresh one is built only when a resolver needs it.
		let local: PayloadRequest | undefined
		const requestFor = async (): Promise<PayloadRequest> => {
			if (opts?.req) {
				return opts.req
			}
			local ??= await createLocalReq({}, payload)
			return local
		}
		const timezone =
			event.timezone ??
			(resolvers.timezone ? await resolvers.timezone(await requestFor(), scope ?? null) : undefined)
		// Goals resolve under the scope the event is stamped with, so a tenant's server event
		// can only ever complete that tenant's goals.
		const goals = resolvers.goals
			? await resolvers.goals(await requestFor(), scope ?? null)
			: undefined
		const now = event.now ?? new Date()
		const stored = await normalizeEvent({
			raw: {
				type: event.type,
				name: event.name,
				path: event.path,
				hostname: event.hostname,
				referrer: event.referrer,
				props: event.props,
				value: event.value,
				currency: event.currency,
			},
			headers: attributionHeaders(event),
			geoResolver: deps.geoResolver,
			salt: await dailySalt(payload, now),
			now,
			scope,
			timezone,
			goals,
		})
		const buffer = deps.getBuffer()
		if (buffer) {
			buffer.add(stored)
		} else {
			await flushBatch(payload, [stored])
		}
	}

/**
 * Records an analytics event from server code: a webhook, a job, a server action. The event
 * goes through the same normalization, sanitization and goal matching a browser event does.
 *
 * Needs the native adapter: a provider slot (Plausible, GA4) has no server ingestion seam
 * here yet, so an install without the native adapter throws rather than dropping the event.
 */
export const trackServerEvent = async (
	payload: Payload,
	event: ServerEventInput,
	opts?: ServerTrackOptions
): Promise<void> => {
	const track = getRuntime(payload)
		?.registry.all()
		.find((adapter) => adapter.ingest?.track)?.ingest?.track
	if (!track) {
		throw new AnalyticsTrackError(
			'analytics: trackServerEvent needs the native adapter; provider-slot server tracking is not supported yet'
		)
	}
	await track(event, opts)
}
