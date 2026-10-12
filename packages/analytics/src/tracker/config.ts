/**
 * What the browser tracker is booted with, shared with the server that builds it. Imports
 * nothing, so `/tracker`, `/react` and `/site` declare it without reaching Payload or Node.
 */

/** The two capture slots an install can fill: the platform's own and the tenant's. */
export type CaptureSlot = 'global' | 'tenant'

export type CaptureClientKind = 'native' | 'posthog' | 'plausible' | 'umami' | 'ga4'

export interface SnippetScript {
	src?: string
	inline?: string
	attrs?: Record<string, string>
	async?: boolean
	defer?: boolean
	type?: string
}

export interface CaptureSnippet {
	scripts: SnippetScript[]
}

/**
 * How an incoming event is recognized as a completion of a goal. `goal` matches an explicit
 * `trackGoal(slug)` call, which is what the attribute and action hookups emit.
 */
export type GoalMatch =
	| { kind: 'event'; name: string }
	| { kind: 'path'; pattern: string }
	| { kind: 'goal' }

/** The goal fields the browser tracker needs; a goal's admin-facing name never leaves the server. */
export interface TrackerGoal {
	/** Stable identifier, kebab-case; unique across the install's goals. */
	slug: string
	match: GoalMatch
	/** Revenue for one completion: a fixed amount, or read from an event property. */
	value?: { fixed?: number; prop?: string }
	/** ISO 4217 code the goal's value is denominated in. */
	currency?: string
}

/**
 * One line of a sale, shaped like a GA4 `items` entry so a vendor sink forwards it as it stands.
 * Only the id is required.
 */
export interface RevenueItem {
	id: string
	name?: string
	quantity?: number
	price?: number
}

/** `capture.autoCapture.items` with every default filled in. */
export interface ResolvedItemCapture {
	impressions: boolean
	clicks: boolean
	pages: boolean
}

/** `capture.autoCapture` with every default filled in. */
export interface ResolvedAutoCapture {
	scrollDepth: boolean
	outboundLinks: boolean
	fileDownloads: boolean
	goalAttribute: boolean
	query: boolean
	items: ResolvedItemCapture
}

export const DEFAULT_ITEM_CAPTURE: ResolvedItemCapture = {
	impressions: true,
	clicks: true,
	pages: true,
}

/** Item capture off: what `items: false` asks for, and what an install binding no item collection gets. */
export const NO_ITEM_CAPTURE: ResolvedItemCapture = {
	impressions: false,
	clicks: false,
	pages: false,
}

/** Scroll depth is the one listener off by default: it fires on every page, for every visitor. */
export const DEFAULT_AUTO_CAPTURE: ResolvedAutoCapture = {
	scrollDepth: false,
	outboundLinks: true,
	fileDownloads: true,
	goalAttribute: true,
	query: true,
	items: DEFAULT_ITEM_CAPTURE,
}

/**
 * The exclusion link while `capture.exclusion` is on: its parameter and the SHA-256 (lowercase hex)
 * of the value that excludes. The token itself never reaches a page.
 */
export interface TrackerExclusion {
	param: string
	tokenHash: string
}

/** What the tracker leaves uncounted (`capture.skip`), each on unless the install turns it off. */
export interface TrackerSkip {
	/** A browser driven by automation, which says so in `navigator.webdriver`. */
	automation: boolean
	/** A page rendered in draft mode, and one shown in Payload's live preview. */
	previews: boolean
}

/**
 * Where Payload's admin answers, as SHA-256 digests (lowercase hex) a page can check an address
 * against but never read the admin's address from.
 */
export interface AdminDigest {
	/** Of the admin's origin; absent when the admin is served from the page's own origin. */
	origin?: string
	/** Of the admin route's path, behind the Next basePath, with no trailing slash (`/` for the root). */
	path: string
}

export interface TrackerSlotConfig {
	slot: CaptureSlot
	kind: CaptureClientKind
	adapterId: string
	/** Mount the snippet and the sink talk to, relative and behind the Next basePath. */
	path: string
	snippet: CaptureSnippet
	/** What the adapter hands its browser client: public settings only, never a credential. */
	client: { kind: CaptureClientKind } & Record<string, string | number | boolean>
	/**
	 * True when `capture.gate` holds this slot until the host's consent manager answers. Was
	 * `requiresConsent` in 1.0.0-beta.11; the tracker still reads that from a cached config.
	 */
	gated: boolean
}

/**
 * Everything the browser tracker needs, served to any visitor: adapters' public `client` and
 * `snippet` settings only, never a query credential or a goal's admin-facing name.
 */
export interface TrackerConfig {
	slots: TrackerSlotConfig[]
	autoCapture: ResolvedAutoCapture
	/**
	 * The request scope's goals, config merged with the collection. Built-in `purchase` stays out: it
	 * matches by slug, and shipping it would tell every site it has a goal.
	 */
	goals: TrackerGoal[]
	/** Where the native sink posts events, relative and behind the Next basePath. */
	ingestPath: string
	/**
	 * The exclusion link for this request's scope, while `capture.exclusion` is on: its
	 * parameter and the hash of its token. Absent, the tracker ignores the parameter.
	 */
	exclusion?: TrackerExclusion
	/** `capture.skip`, present only when the install turned one off. Absent, every skip is on. */
	skip?: TrackerSkip
	/** The page was rendered in draft mode (`getTrackerConfig`'s `draft`). */
	draft?: true
	/**
	 * Where Payload's admin answers, while previews are skipped: a page shown by one of its pages is
	 * its live preview. Digests alone, so no page names the admin's host or route.
	 */
	admin?: AdminDigest
}
