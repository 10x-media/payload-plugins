import { createHmac } from 'node:crypto'

/** HMAC-SHA256 over `${timestamp}.${body}`, hex-encoded. */
export const signPayload = (args: { secret: string; timestamp: number; body: string }): string =>
	createHmac('sha256', args.secret).update(`${args.timestamp}.${args.body}`).digest('hex')

/** Wrap a signature hex in the versioned header value. */
export const signatureHeader = (hex: string): string => `v1=${hex}`
