/** One rewrite the runtime proxy endpoint answers, source pattern to vendor upstream. */
export interface ProxyRoute {
	source: string
	upstream: string
}

/** Routes a Next rewrites helper and the runtime proxy endpoint both consume. */
export interface ProxyDescriptor {
	routes: ProxyRoute[]
	forwardHeaders?: string[]
	/**
	 * The vendor serves some paths only with a trailing slash (PostHog's capture
	 * endpoints). Both slash forms always match; this decides what reaches the vendor:
	 * true keeps the request's trailing slash on the upstream path, absent or false
	 * normalizes it away. Next apps proxying such a vendor through rewrites also need
	 * `skipTrailingSlashRedirect: true`.
	 */
	trailingSlashes?: boolean
}

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

export type CaptureClientKind = 'native' | 'posthog' | 'plausible' | 'umami'

/**
 * Pure descriptor of how a vendor's browser tracker is proxied and booted, consumed by
 * a later runtime proxy endpoint, a Next rewrites helper, and a snippet renderer. Never
 * carries private/secret credentials (e.g. PostHog's Query API key); only what the
 * browser is allowed to see.
 */
export interface CaptureSupport {
	proxy: ProxyDescriptor
	snippet(args: { path: string }): CaptureSnippet
	client: { kind: CaptureClientKind } & Record<string, string | number | boolean>
}
