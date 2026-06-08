import { createHmac } from 'node:crypto'

export interface VisitorHashInput {
	ip: string
	ua: string
	site: string
	salt: string
}

// The salt rotates daily so a visitor's hash auto-expires every 24h, giving
// cookieless uniqueness without storing PII (the raw IP is hashed immediately
// and never persisted).
export function dailyVisitorHash({ ip, ua, site, salt }: VisitorHashInput): string {
	return createHmac('sha256', salt).update(`${ip}|${ua}|${site}`).digest('hex')
}

export function deriveSessionId(visitorHash: string, hourBucket: string): string {
	return createHmac('sha256', visitorHash).update(hourBucket).digest('hex').slice(0, 32)
}
