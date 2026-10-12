import type { CaptureSlot, RevenueItem, SnippetScript } from './config'

/** The browser globals the tracker touches, passed in so a test or another window can stand in. */
export type TrackerWindow = Window & typeof globalThis

/**
 * One event on the wire, posted verbatim by the native sink. Vendor sinks skip pageviews and
 * engagements, which their own scripts measure.
 */
export interface TrackerEvent {
	type: 'pageview' | 'event' | 'goal' | 'engagement'
	/** Event name, or the goal slug for `type: 'goal'`. Absent on a pageview and an engagement. */
	name?: string
	path: string
	hostname: string
	referrer?: string
	/**
	 * The utm keys and click ids as a query string, on a pageview and its engagement only: nothing else
	 * of the address is sent, and ingest stores none of it verbatim.
	 */
	query?: string
	props?: Record<string, unknown>
	value?: number
	currency?: string
	/** The lines of a sale. Stored under props by native ingest, forwarded to GA4 as `items`. */
	items?: RevenueItem[]
	/**
	 * The sale's order, so a repeat counts once. Native keeps only a digest, and the server's record of
	 * the same order replaces this one.
	 */
	orderId?: string
	/** On an engagement only: time the page was visible since its previous engagement. */
	durationMs?: number
	/**
	 * On an engagement only: ms since its pageview by the page's monotonic clock, at most a day, so ingest
	 * files the time on the pageview's day whatever the device clock says.
	 */
	sinceMs?: number
	/**
	 * How long the event waited in the page before it was sent (a pending gate, a prerender, a link
	 * being checked), by the page's own steady clock, at most a day. Ingest files it that much earlier.
	 */
	ageMs?: number
	/** On a pageview only: `1` when a single-page app made it without loading a document. */
	nav?: 1
	/**
	 * Present only while scroll capture is on: 0 on a pageview, and on an engagement the points out of
	 * 100 scrolled deeper since the previous one.
	 */
	scrollDepth?: number
	/**
	 * The content item an event or a goal belongs to: its `<collection>:<id>` ref, with the
	 * server's signature after an `@` when the page carries one.
	 */
	item?: string
	/** The item's display name, for vendor slots only: the native sink never sends it. */
	itemName?: string
	/** On an engagement only: the items seen on the page since the previous one, as `item` is written. */
	impressions?: string[]
}

/** Which content item an event belongs to, for the calls that can say so. */
export interface ItemOptions {
	/**
	 * The item, as `signItemRef(payload, collection, id)` writes it on the server: native keeps an
	 * unsigned `itemRef(collection, id)` only on an install that makes signatures optional.
	 */
	item?: string
}

/** One capture slot's delivery target. */
export interface Sink {
	readonly slot: CaptureSlot
	ready(): Promise<void>
	send(event: TrackerEvent): void
	/**
	 * Sets the vendor's own opt-out switch: the only thing that reaches a server-rendered snippet of an
	 * ungated slot, which counts its pageview before the tracker boots.
	 */
	exclude?(excluded: boolean): void
}

/**
 * `pending` until the consent manager answers, then `open` or `closed`. An ungated slot starts
 * `open`, a slot the config does not fill stays `closed`; held in memory only.
 */
export type GateStatus = 'pending' | 'open' | 'closed'

/**
 * The host's answer to the gate. A boolean answers for every slot `capture.gate` holds; a record
 * answers for the slots it names, held or not, and a slot it leaves `undefined` keeps its gate.
 */
export type GateState = boolean | Partial<Record<CaptureSlot, boolean | undefined>>

/**
 * Host seam for getting a snippet script into the page: CSP nonces and frameworks with their
 * own script loader replace it. Resolves once the script has run.
 */
export type LoadScript = (script: SnippetScript) => Promise<void>

export interface TrackerOptions {
	loadScript?: LoadScript
	window?: TrackerWindow
	/** CSP nonce applied to scripts the default loader injects. */
	nonce?: string
	/**
	 * The answer the host already has at boot, applied before anything is delivered: what a
	 * server that knows the visitor's decision renders the page with.
	 */
	gate?: GateState
	/**
	 * `false` injects no vendor script at all, for a consent manager that loads the vendor SDKs
	 * itself: each vendor slot forwards once that vendor's global exists. Default true.
	 */
	snippets?: boolean
}

/**
 * A sale, in GA4's vocabulary. `orderId` keeps a success page rendered twice from counting twice,
 * and lets the server's record of the same sale replace this one.
 */
export interface PurchaseInput extends ItemOptions {
	orderId?: string
	/** The money that moved. Never below zero: a refund is server-side. */
	value: number
	currency?: string
	items?: RevenueItem[]
	props?: Record<string, unknown>
	/** Goal slug the sale is booked against; defaults to `purchase`. */
	goal?: string
}

/**
 * A refund. Server-side only: the browser call is dropped with a development warning, because
 * a public beacon that could subtract from a revenue bucket would let anyone forge one.
 */
export interface RefundInput {
	orderId: string
	/** The money that came back, as a positive amount; the sign is the call's, not the caller's. */
	value: number
	currency?: string
	props?: Record<string, unknown>
}

/** A goal's own amount for this one completion, and the item it belongs to. */
export interface TrackGoalOptions extends ItemOptions {
	value?: number
	currency?: string
}

export interface Tracker {
	page(): void
	/** `opts.item` files the event under a content item as well as under the page. */
	track(name: string, props?: Record<string, unknown>, opts?: ItemOptions): void
	trackGoal(slug: string, opts?: TrackGoalOptions): void
	/**
	 * Records a sale with the amount that actually moved; an `orderId` keeps a double fire counting
	 * once. A negative amount is dropped: refunds are server-side.
	 */
	purchase(input: PurchaseInput): void
	/** Always a no-op in the browser, with a development warning. Refunds are server-side. */
	refund(input: RefundInput): void
	/**
	 * Opens or closes capture slots, as the host's consent manager answers on every page load and on
	 * every change. Nothing is stored: each load, and each back/forward cache restore, starts pending.
	 */
	setGate(state: GateState): void
	/** Each capture slot's gate, replaced whenever one changes. */
	readonly gate: Readonly<Record<CaptureSlot, GateStatus>>
	/**
	 * True while this browser is excluded from capture. False until a slot opens: the stored flag
	 * is read no earlier.
	 */
	readonly excluded: boolean
	/**
	 * Takes this browser out of capture, or puts it back. Nothing skipped is replayed, and engagement on
	 * the open page resumes with the next pageview.
	 */
	exclude(next: boolean): void
	/** Sends the open page's engagement now, when it gained anything since the last one. */
	flush(): void
	/**
	 * Sends the open page's engagement, then detaches every listener and history patch. A destroyed
	 * tracker sends nothing more and loads nothing; `exclude` still persists the flag.
	 */
	destroy(): void
}
