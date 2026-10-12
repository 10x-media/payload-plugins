import type { Payload, PayloadRequest } from 'payload'
import type { RawEventInput } from '../native/ingest/normalizeEvent'
import type { HitType } from '../native/store/types'

/**
 * One event recorded from server code. Browser fields mean what they mean on the wire and pass the
 * same sanitizers; the rest stand in for what a request would carry.
 */
export type ServerEventInput = Pick<
	RawEventInput,
	| 'name'
	| 'path'
	| 'referrer'
	| 'query'
	| 'props'
	| 'value'
	| 'currency'
	| 'items'
	| 'revenue'
	| 'orderId'
	| 'refundId'
	| 'item'
> & {
	/** Time on a page is measured in the browser, so a server event is never an engagement. */
	type: Exclude<HitType, 'engagement'>
	/**
	 * The site the event belongs to. Required, and stored as given: there is no request behind
	 * a server event to attribute it to, so the caller owns the value.
	 */
	hostname: string
	/**
	 * Attribution inputs overlaid on `opts.req`'s headers, ignored under `identity: 'none'`. Without
	 * either the event has no visitor, device, browser, OS or language; none is fabricated.
	 */
	ip?: string
	userAgent?: string
	/**
	 * Analytics boundary to stamp; null is install-wide. Unset resolves from `opts.req`.
	 * Ignored on an unscoped install, and never validated against the scopes that exist.
	 */
	scope?: string | null
	/**
	 * The IANA timezone whose local day picks the salt the visitor is hashed with, for a call that
	 * has no request to resolve the scope's own from. The day the event is counted on is its scope's.
	 */
	timezone?: string
	/**
	 * Event time, default now. A time past native's `retention.rawDays` or more than five minutes
	 * ahead of the server clock is refused with an `AnalyticsTrackError`.
	 */
	now?: Date
}

/**
 * Whose event a server call records. `'request'` attributes it to the visitor behind `req` (or
 * `ip` and `userAgent`); `'none'` to no visitor, reading no address, agent, language or location.
 */
export type ServerTrackIdentity = 'request' | 'none'

export interface ServerTrackOptions {
	/** The request the event belongs to: attribution, scope and timezone all come from it. */
	req?: PayloadRequest
	/**
	 * `'none'` records the event as no visitor's while `req` still supplies scope, timezone and
	 * goals. Default `'none'` while `capture.gate` holds the native slot, else `'request'`.
	 */
	identity?: ServerTrackIdentity
	/**
	 * Wait for the write to land rather than resolving once queued. On SQLite, a call inside a
	 * transaction `req` holds open still resolves at once and stores on commit.
	 */
	flush?: boolean
}

/**
 * An adapter's server-side ingestion. It is handed the Payload instance to write through, so it
 * works on any instance that runs the plugin, a jobs worker booted without `onInit` included.
 */
export type ServerTrack = (
	payload: Payload,
	event: ServerEventInput,
	opts?: ServerTrackOptions
) => Promise<void>

/**
 * Applies an adapter's hostname policy to a request, null when it refuses the host, so server code
 * standing in for a browser event never trusts a forgeable `Host`.
 */
export type IngestHostnameResolver = (args: {
	req: PayloadRequest
	/** What the caller believes the host is, never trusted on its own. */
	claimed?: string
	scope?: string | null
}) => Promise<string | null>

/** Thrown instead of dropping the event: a server caller can handle a rejected promise. */
export class AnalyticsTrackError extends Error {
	constructor(message: string) {
		super(message)
		this.name = 'AnalyticsTrackError'
	}
}
