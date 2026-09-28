/** The schemes a link may use; the server strips anything else when it saves a message. */
export const isAllowedUrl = (url: string): boolean => /^(https?:\/\/|mailto:)/i.test(url.trim())

/**
 * What the user typed into the link field as a URL we accept, or null: an
 * explicit http(s) or mailto URL, an email address, or a bare domain (made
 * https).
 */
export const normalizeUrl = (raw: string): null | string => {
	const value = raw.trim()
	if (!value || /\s/.test(value)) return null
	if (isAllowedUrl(value)) return value
	if (/^[a-z][a-z0-9+.-]*:(?!\d)/i.test(value)) return null
	if (/^[^@/]+@[^@/]+\.[a-z]{2,}$/i.test(value)) return `mailto:${value}`
	if (/^[\w-]+(\.[\w-]+)*\.[a-z]{2,}(:\d+)?([/?#].*)?$/i.test(value)) return `https://${value}`
	return null
}

/** A URL as text in the editor, without the scheme noise. */
export const displayUrl = (url: string): string =>
	url
		.replace(/^mailto:/i, '')
		.replace(/^https?:\/\//i, '')
		.replace(/\/$/, '')
