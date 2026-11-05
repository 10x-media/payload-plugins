import type {
	CaptureSnippet,
	HeldSlotMode,
	TrackerSlotConfig,
	WithoutConsentLevel,
} from '../tracker/config'
import type { FetchLike } from './fetch'

/** What a proxied route serves: a script the browser runs, or data its tracker sends and reads. */
export type ProxyRouteKind = 'script' | 'data'

/** One rewrite the runtime proxy endpoint answers, source pattern to vendor upstream. */
export interface ProxyRoute {
	source: string
	upstream: string
	/**
	 * How the runtime proxy labels the answer: `script` as JavaScript; `data` keeps JSON or plain
	 * text, else becomes plain text, and is sandboxed so it never runs as a page of the site.
	 */
	kind: ProxyRouteKind
}

/** Routes a Next rewrites helper and the runtime proxy endpoint both consume. */
export interface ProxyDescriptor {
	routes: ProxyRoute[]
	forwardHeaders?: string[]
	/**
	 * True keeps the request's trailing slash upstream (PostHog's capture endpoints need it); absent
	 * or false strips it. Next rewrites to such a vendor also need `skipTrailingSlashRedirect: true`.
	 */
	trailingSlashes?: boolean
	/**
	 * The fetch the runtime proxy reaches these routes with, the same one the adapter reads with.
	 * Unset, the global fetch.
	 */
	fetch?: FetchLike
}

/**
 * How a vendor counts without consent. `inherent`: it never stores anything, so one snippet serves
 * every phase. `switched`: its sink switches the vendor's client between cookieless and full.
 * `default` is the level `capture.withoutConsent: 'cookieless'` gives it (GA4: `off`).
 */
export interface CookielessSupport {
	kind: 'inherent' | 'switched'
	default?: WithoutConsentLevel
}

/** What a snippet starts in: `cookieless` for a held slot counting before an answer, else `full`. */
export type SnippetMode = 'cookieless' | 'full'

export interface SnippetArgs {
	path: string
	/**
	 * The request's resolved scope, which a vendor able to carry it stamps on every event. Null when
	 * unscoped or unresolved.
	 */
	scope?: string | null
	/**
	 * The client the snippet initialises, set only for a vendor that runs a second client beside the
	 * other slot's (PostHog).
	 */
	instance?: string
	/** Absent (a caller from before 1.0.0-beta.15) means `full`. */
	mode?: SnippetMode
	/**
	 * True when the slot drops to a cookieless level in some phase without consent, so the snippet
	 * boots a client able to switch (PostHog: `cookieless_mode: 'on_reject'`). False keeps the
	 * strict boot of 1.0.0-beta.14.
	 */
	withoutConsent?: boolean
}

/**
 * How a vendor's browser tracker is proxied and booted. Carries only what the browser may see,
 * never a secret credential such as PostHog's Query API key.
 */
export interface CaptureSupport {
	proxy: ProxyDescriptor
	snippet(args: SnippetArgs): CaptureSnippet
	client: TrackerSlotConfig['client']
	/** Absent: the vendor cannot count without consent, so its held slot sends nothing until then. */
	cookieless?: CookielessSupport
	/**
	 * The adapter's own `withoutConsent` (factory option or provider document), which beats
	 * `capture.withoutConsent` for its slot in both phases. Ignored without `cookieless`.
	 */
	withoutConsent?: HeldSlotMode
}
