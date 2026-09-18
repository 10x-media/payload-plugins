import { createLocalReq, type Payload, type PayloadRequest } from 'payload'
import {
	AnalyticsTrackError,
	type ServerEventInput,
	type ServerTrack,
	type ServerTrackOptions,
} from '../../core/serverEvent'
import { getRuntime } from '../../plugin/runtime'
import type { GeoResolver } from '../geo/geoResolver'
import { SERVER_USER_AGENT } from './device'
import type { IngestAttribution, IngestResolvers } from './endpoint'
import { flushBatch } from './flushBatch'
import { normalizeEvent, type StoredEvent } from './normalizeEvent'
import { dailySalt } from './salt'
import { rawEventError } from './validate'
import type { WriteBuffer } from './writeBuffer'

export interface ServerTrackDeps {
	/** Null until the adapter's onInit has run. */
	getPayload: () => Payload | null
	geoResolver: GeoResolver
	getBuffer: () => WriteBuffer<StoredEvent> | null
	/** Read late: the register context that carries them arrives after the adapter is built. */
	getResolvers: () => IngestResolvers
	/** Read late for the same reason: the plugin option arrives with the register context. */
	getAttribution: () => IngestAttribution
}

/**
 * The originating request's own headers, so a server event attributes exactly like the
 * browser event it stands in for: the platform's geo headers reach the geo resolver and the
 * visitor hashes to the same person. Explicit `ip` / `userAgent` overlay them.
 *
 * With no request and no user agent the synthetic server agent stands in, which hashes every
 * such event in a day to one visitor per site and reports no device at all.
 */
const attributionHeaders = (event: ServerEventInput, req?: PayloadRequest): Headers => {
	const headers = new Headers(req?.headers)
	if (event.ip) {
		headers.set('x-forwarded-for', event.ip)
	}
	if (event.userAgent) {
		headers.set('user-agent', event.userAgent)
	}
	if (!headers.get('user-agent')) {
		headers.set('user-agent', SERVER_USER_AGENT)
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
		// Trusted server code: it supplies its own hostname, so the resolver the HTTP endpoint
		// runs is bypassed and the hostname stays required here.
		const invalid = rawEventError(event, { requireHostname: true })
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
				referrer: event.referrer,
				query: event.query,
				props: event.props,
				value: event.value,
				currency: event.currency,
			},
			hostname: event.hostname,
			headers: attributionHeaders(event, opts?.req),
			geoResolver: deps.geoResolver,
			salt: await dailySalt(payload, now),
			now,
			scope,
			timezone,
			goals,
			trustedProxyHops: deps.getAttribution().trustedProxyHops,
		})
		const buffer = deps.getBuffer()
		if (!buffer) {
			await flushBatch(payload, [stored])
			return
		}
		buffer.add(stored)
		if (opts?.flush) {
			await buffer.flush()
		}
	}

/**
 * Records an analytics event from server code: a webhook, a job, a server action. The event
 * goes through the same normalization, sanitization and goal matching a browser event does.
 * Pass `opts.req` whenever there is a request behind the event, so it inherits that request's
 * attribution, scope and reporting timezone.
 *
 * `event.scope` overrides the request's scope; it is ignored on an unscoped install and is
 * never checked against the scopes that exist, so the caller owns what it stamps.
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
