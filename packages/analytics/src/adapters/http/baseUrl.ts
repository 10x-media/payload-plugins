/** A vendor address with any trailing slash dropped, so a path appended to it gains exactly one. */
export const withoutTrailingSlash = (address: string): string => address.replace(/\/+$/, '')

/** The hostname of an address, or an empty string for one that does not parse. */
export const hostnameOf = (address: string): string => {
	try {
		return new URL(address).hostname
	} catch {
		return ''
	}
}
