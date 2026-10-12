import { createHmac } from 'node:crypto'

interface VisitorHashInput {
	ip: string
	ua: string
	site: string
	salt: string
}

/** Characters in a visitor id: 96 bits of the day's HMAC, base64url. */
export const VISITOR_ID_LENGTH = 16

/**
 * Visitor id a hit row stores (`v`). The address is never stored and the salt rotates daily, so
 * the id names a visitor for one day only.
 */
export const dailyVisitorId = ({ ip, ua, site, salt }: VisitorHashInput): string =>
	createHmac('sha256', salt)
		.update(`${ip}|${ua}|${site}`)
		.digest('base64url')
		.slice(0, VISITOR_ID_LENGTH)
