import { referrerHost } from './referrer'

/**
 * The `source` dimension's bucket: the same bare host the `referrer` dimension reads, or
 * `Direct` when there is no referrer, it is unparseable, or it points back at the site itself.
 * So `source` is not a traffic channel today, only a referrer host with a name for the
 * hostless case; classifying it (search, social, paid) is a follow-up, and the two dimensions
 * stay separate so that change lands without moving anyone's saved links.
 */
export const deriveSource = (referrer: unknown, selfHostname: string): string =>
	referrerHost(referrer, selfHostname) ?? 'Direct'
