import { createHmac } from 'node:crypto'

// Distinct from @10x-media/webhooks' `X-Webhook-Signature` (which signs `timestamp.body`): this action signs the body alone, so a separate header prevents a consumer mistaking the two verification schemes.
export const SIGNATURE_HEADER = 'X-Form-Signature'

/** HMAC-SHA256 over `body`, hex-encoded, wrapped in the versioned header value (`v1=<hex>`). */
export const signPayload = (body: string, secret: string): string =>
	`v1=${createHmac('sha256', secret).update(body).digest('hex')}`
