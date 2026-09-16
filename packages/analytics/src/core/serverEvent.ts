import type { PayloadRequest } from 'payload'
import type { RawEventInput } from '../native/ingest/normalizeEvent'

/**
 * One event recorded from server code. The fields a browser event carries mean exactly what
 * they mean on the wire (and go through the same sanitizers); the rest say what the server
 * knows that a browser request would otherwise have said for itself.
 */
export type ServerEventInput = Pick<
	RawEventInput,
	'type' | 'name' | 'path' | 'hostname' | 'referrer' | 'query' | 'props' | 'value' | 'currency'
> & {
	/**
	 * Attribution inputs, overlaid on `opts.req`'s own headers when there is a request.
	 * With neither, the event is attributed to the day's synthetic server visitor and
	 * reports no device. No IP is ever fabricated.
	 */
	ip?: string
	userAgent?: string
	/**
	 * Analytics boundary to stamp; null is install-wide. Unset resolves from `opts.req`.
	 * Ignored on an unscoped install, and never validated against the scopes that exist.
	 */
	scope?: string | null
	/** IANA reporting timezone the rollup day bucket is computed in. */
	timezone?: string
	/** Event time; defaults to now. */
	now?: Date
}

export interface ServerTrackOptions {
	/** The request the event belongs to: attribution, scope and timezone all come from it. */
	req?: PayloadRequest
	/**
	 * Wait for the write to land. On an install with a write buffer the call otherwise
	 * resolves as soon as the event is queued, and a failed flush only reaches the logger.
	 */
	flush?: boolean
}

export type ServerTrack = (event: ServerEventInput, opts?: ServerTrackOptions) => Promise<void>

/** Thrown instead of dropping the event: a server caller can handle a rejected promise. */
export class AnalyticsTrackError extends Error {
	constructor(message: string) {
		super(message)
		this.name = 'AnalyticsTrackError'
	}
}
