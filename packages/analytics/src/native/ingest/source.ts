import { referrerHost } from './referrer'

/**
 * Reduce a raw referrer URL to a coarse traffic source: the bare referrer host
 * (without `www.`), or `Direct` when there is no referrer, it is unparseable, or it
 * points back at the site itself (internal navigation is not a traffic source).
 */
export const deriveSource = (referrer: unknown, selfHostname: string): string =>
	referrerHost(referrer, selfHostname) ?? 'Direct'
