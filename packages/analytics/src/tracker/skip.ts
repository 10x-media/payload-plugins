import type { AdminDigest, TrackerSkip } from './config'
import { matchesDigest } from './digest'
import type { TrackerWindow } from './types'

export const DEFAULT_TRACKER_SKIP: Readonly<TrackerSkip> = { automation: true, previews: true }

type SkipReason = 'automation' | 'draft'

/** The part of a tracker config the skip reads, so a config cached before it existed counts as default. */
export interface SkipConfig {
	skip?: TrackerSkip
	/** Set by the server for a page rendered in draft mode. */
	draft?: true
	/** Where Payload's admin is, for a page that may be its live preview. */
	admin?: AdminDigest
}

const skipOf = (config: SkipConfig): TrackerSkip => config.skip ?? DEFAULT_TRACKER_SKIP

/** Whether a page the server rendered in draft mode goes uncounted: decided before any script runs. */
export const skipsDraft = (config: SkipConfig): boolean =>
	config.draft === true && skipOf(config).previews

/** What the page reads of the window showing it, which throws when that window is cross-origin. */
interface Embedder {
	readonly location: Pick<Location, 'origin' | 'pathname'>
}

const isEmbedder = (value: unknown): value is Embedder => {
	try {
		return typeof value === 'object' && value !== null && 'location' in value
	} catch {
		return false
	}
}

/** The window this page is shown in: the parent of its frame, else the window that opened it. */
const embedderOf = (win: TrackerWindow): Embedder | null => {
	try {
		if (win.parent && win.parent !== win) {
			return win.parent
		}
	} catch {
		return null
	}
	const opener: unknown = win.opener
	return isEmbedder(opener) ? opener : null
}

const originOf = (address: string): string | null => {
	try {
		return address === '' ? null : new URL(address).origin
	} catch {
		return null
	}
}

/** The embedder's own address, or null when the browser keeps it from this page. */
const readable = (embedder: Embedder): Pick<Location, 'origin' | 'pathname'> | null => {
	try {
		const { origin, pathname } = embedder.location
		return { origin, pathname }
	} catch {
		return null
	}
}

/** `/a/b/c` as every path it sits under, itself included: `/`, `/a`, `/a/b`, `/a/b/c`. */
const pathsUnder = (pathname: string): string[] => {
	const segments = pathname.split('/').filter((segment) => segment !== '')
	return segments.map((_, index) => `/${segments.slice(0, index + 1).join('/')}`).concat('/')
}

/** Whether `origin` is the admin's: its digest's, or the page's own when the admin is served there. */
const isAdminOrigin = (win: TrackerWindow, origin: string, admin: AdminDigest): Promise<boolean> =>
	admin.origin === undefined
		? Promise.resolve(origin === originOf(win.location.href))
		: matchesDigest(win, origin, admin.origin)

const shownByAdmin = async (
	win: TrackerWindow,
	embedder: Embedder,
	admin: AdminDigest
): Promise<boolean> => {
	const address = readable(embedder)
	if (address !== null) {
		if (!(await isAdminOrigin(win, address.origin, admin))) {
			return false
		}
		const matches = await Promise.all(
			pathsUnder(address.pathname).map((path) => matchesDigest(win, path, admin.path))
		)
		return matches.includes(true)
	}
	if (admin.origin === undefined) {
		return false
	}
	const ancestors: DOMStringList | undefined = win.location.ancestorOrigins
	const origin = ancestors?.item(0) ?? originOf(win.document.referrer)
	return origin !== null && matchesDigest(win, origin, admin.origin)
}

/**
 * Whether an admin page shows this one in a frame or a window it opened (Payload's live preview),
 * checked against the config's digests; null when there is nothing to check.
 */
export const inLivePreview = (config: SkipConfig, win: TrackerWindow): Promise<boolean> | null => {
	if (!skipOf(config).previews || config.admin === undefined) {
		return null
	}
	const embedder = embedderOf(win)
	return embedder === null ? null : shownByAdmin(win, embedder, config.admin)
}

/** Why the page should not be counted, as far as it is known at once; see {@link inLivePreview}. */
export const skipReason = (config: SkipConfig, win: TrackerWindow): SkipReason | null => {
	const skip = skipOf(config)
	if (skip.automation && win.navigator?.webdriver === true) {
		return 'automation'
	}
	if (skipsDraft(config)) {
		return 'draft'
	}
	return null
}
