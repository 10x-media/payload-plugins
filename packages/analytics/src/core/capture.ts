import type { CaptureSnippet, TrackerSlotConfig } from '../tracker/config'
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
 * How a vendor's browser tracker is proxied and booted. Carries only what the browser may see,
 * never a secret credential such as PostHog's Query API key.
 */
export interface CaptureSupport {
	proxy: ProxyDescriptor
	/**
	 * `scope` is the request's resolved scope, which a vendor able to carry it stamps on every event.
	 * Null when unscoped or unresolved. `instance` names the client the snippet initialises, set
	 * only for a vendor that runs a second client beside the other slot's (PostHog).
	 */
	snippet(args: { path: string; scope?: string | null; instance?: string }): CaptureSnippet
	client: TrackerSlotConfig['client']
}
