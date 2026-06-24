const stripWww = (host: string): string => host.replace(/^www\./, '')

/**
 * Reduce a raw referrer URL to a coarse traffic source: the bare referrer host
 * (without `www.`), or `Direct` when there is no referrer, it is unparseable, or it
 * points back at the site itself (internal navigation is not a traffic source).
 */
export const deriveSource = (referrer: string | undefined, selfHostname: string): string => {
	if (!referrer) {
		return 'Direct'
	}
	let host: string
	try {
		host = new URL(referrer).hostname
	} catch {
		return 'Direct'
	}
	if (!host || stripWww(host) === stripWww(selfHostname)) {
		return 'Direct'
	}
	return stripWww(host)
}
