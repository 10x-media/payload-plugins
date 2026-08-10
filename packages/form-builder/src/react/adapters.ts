/** The plugin's navigation intent for a post-submit redirect, passed through to the adapter. */
export type NavigateOptions = { replace: boolean }

/**
 * Client persistence for a poll's per-browser voted flag. `read` reports whether the flag is set;
 * `write` sets it after a successful vote.
 */
export type VoteStorage = {
	read: (key: string) => boolean
	write: (key: string) => void
}

/** Loads a third-party script and resolves once it is executable (e.g. a consent-gated loader). */
export type LoadScript = (src: string) => Promise<void>

/**
 * Host-owned effects. Every member is optional and defaults to the current DOM behavior, so
 * omitting the prop entirely preserves the default semantics exactly.
 *
 * - `navigate`: replaces `window.location.assign`/`.replace` for the post-submit redirect. When
 *   set, the plugin never touches `window.location` for that form; a throwing adapter propagates
 *   and never falls back to a hard navigation. Not awaited.
 * - `voteStorage`: replaces the `<Poll>` localStorage voted-flag read/write; `false` disables
 *   client persistence entirely (e.g. when the server-side `poll.votedCookie` is the source of truth).
 * - `loadScript`: replaces the captcha widgets' `document.head` script injection (consent
 *   managers, CSP nonces). The per-src cache and evict-on-failure retry still apply.
 */
export type FormAdapters = {
	navigate?: (url: string, options: NavigateOptions) => void
	voteStorage?: VoteStorage | false
	loadScript?: LoadScript
}

/** The default navigation: a full document load, push semantics unless `replace` is requested. */
export const defaultNavigate = (url: string, options: NavigateOptions): void => {
	if (typeof window === 'undefined') {
		return
	}
	if (options.replace) {
		window.location.replace(url)
	} else {
		window.location.assign(url)
	}
}
