import { SERVER_USER_AGENT } from './device'

export type BrowserName = 'chrome' | 'safari' | 'firefox' | 'edge' | 'opera' | 'samsung' | 'other'

export type OsName = 'ios' | 'android' | 'windows' | 'macos' | 'linux' | 'chromeos' | 'other'

/**
 * Order is the whole algorithm: every Chromium fork still calls itself Chrome, and every iOS
 * browser still calls itself Safari, so the fork has to be recognized before the engine it
 * borrowed the token from.
 */
const BROWSERS: ReadonlyArray<[RegExp, BrowserName]> = [
	[/edg(?:a|ios|e)?\//, 'edge'],
	[/\bopr\/|\bopt\/|\bopera\b/, 'opera'],
	[/samsungbrowser/, 'samsung'],
	[/firefox\/|fxios\//, 'firefox'],
	[/chrome\/|crios\/|chromium\//, 'chrome'],
	[/safari\//, 'safari'],
]

/**
 * `CrOS` and `Android` both sit inside an `X11`/`Linux` UA, so they are matched ahead of it.
 * `cros` needs its word boundaries: it is also a substring of `Microsoft`.
 */
const PLATFORMS: ReadonlyArray<[RegExp, OsName]> = [
	[/iphone|ipad|ipod/, 'ios'],
	[/android/, 'android'],
	[/\bcros\b/, 'chromeos'],
	[/windows|win64|win32/, 'windows'],
	[/macintosh|mac os x/, 'macos'],
	[/linux|x11/, 'linux'],
]

const lookup = <T>(table: ReadonlyArray<[RegExp, T]>, ua: string, fallback: T): T | undefined => {
	if (ua === SERVER_USER_AGENT) {
		return undefined
	}
	const s = ua.toLowerCase()
	return table.find(([pattern]) => pattern.test(s))?.[1] ?? fallback
}

/**
 * Coarse browser family from a user-agent string, `other` for anything unrecognized (a bot,
 * a crawler, an HTTP client), and undefined when the agent is the synthetic server one so
 * server events abstain from the browser breakdown rather than skewing it.
 */
export const classifyBrowser = (ua: string): BrowserName | undefined =>
	lookup(BROWSERS, ua, 'other')

/**
 * Operating system from a user-agent's platform tokens, on the same terms as
 * `classifyBrowser`: `other` when nothing matches, undefined for the server agent.
 */
export const classifyOs = (ua: string): OsName | undefined => lookup(PLATFORMS, ua, 'other')
