import type { CaptureSlot } from '../capture/slots'
import type { SnippetScript } from '../core/capture'

/**
 * The browser globals the tracker touches. Every module takes one explicitly rather than
 * reaching for `window`, so a test (or a multi-window host) can hand it a different one.
 */
export type TrackerWindow = Window & typeof globalThis

/**
 * One event on the wire. The native sink posts this shape verbatim to `ingestPath`;
 * vendor sinks map it onto their own SDK call and ignore `type: 'pageview'` because the
 * vendor script tracks pageviews itself.
 */
export interface TrackerEvent {
	type: 'pageview' | 'event' | 'goal'
	/** Event name, or the goal slug for `type: 'goal'`. Absent on a pageview. */
	name?: string
	path: string
	hostname: string
	referrer?: string
	/**
	 * The page's query string without its leading `?`, on pageviews only. Ingest reads the
	 * utm keys out of it and drops the rest; the raw string is never stored.
	 */
	query?: string
	props?: Record<string, unknown>
	value?: number
	currency?: string
	/** Time spent on the page, set when a buffered pageview is flushed. */
	durationMs?: number
	/** Deepest scroll position reached on the page, 0-100. */
	scrollDepth?: number
}

/** One capture slot's delivery target. `flush` exists only on sinks that buffer. */
export interface Sink {
	readonly slot: CaptureSlot
	ready(): Promise<void>
	send(event: TrackerEvent): void
	flush?(): void
	/**
	 * Sets or clears the vendor's own opt-out switch, for the vendors that have one. The
	 * tracker's gate stops what it delivers itself; a snippet the server rendered for an
	 * ungated slot runs before the tracker boots and counts its own pageview, and only the
	 * vendor's switch reaches that.
	 */
	exclude?(excluded: boolean): void
}

export type ConsentState = 'granted' | 'denied'

/**
 * Host seam for getting a snippet script into the page: consent managers, CSP nonces, and
 * frameworks with their own script loader all replace it. Resolves once the script has run.
 */
export type LoadScript = (script: SnippetScript) => Promise<void>

export interface TrackerOptions {
	loadScript?: LoadScript
	window?: TrackerWindow
	/** CSP nonce applied to scripts the default loader injects. */
	nonce?: string
	/** Persist the consent decision in `localStorage`. Default true. */
	persistConsent?: boolean
	/**
	 * Query parameter that takes this browser out of capture (`=1`) or puts it back (`=0`).
	 * Default `analytics_exclude`; `false` ignores the parameter but still honours a flag
	 * an earlier visit set.
	 */
	exclusionParam?: string | false
}

export interface Tracker {
	page(): void
	track(name: string, props?: Record<string, unknown>): void
	trackGoal(slug: string, opts?: { value?: number; currency?: string }): void
	consent(state: ConsentState): void
	/** True while this browser is excluded from capture. */
	readonly excluded: boolean
	/**
	 * Takes this browser out of capture, or puts it back. Clearing resumes from that point:
	 * what was skipped is gone, never replayed.
	 */
	exclude(next: boolean): void
	/** Sends whatever is buffered right now, chiefly the open pageview and its duration. */
	flush(): void
	/** Flushes the buffered pageview, then detaches every listener and history patch. */
	destroy(): void
}
