import { createHmac } from 'node:crypto'

import { SIGNATURE_VERSION } from '../constants'
import { secretKey } from '../secrets/format'

/**
 * Standard Webhooks signature: HMAC-SHA256 over `${id}.${timestamp}.${body}`, base64-encoded,
 * keyed by the base64-decoded secret. `body` must be the exact bytes sent, never a re-serialized
 * copy, or receivers compute a different MAC over the same document.
 */
export const signPayload = (args: {
	secret: string
	id: string
	timestamp: number
	body: string
}): string =>
	createHmac('sha256', secretKey(args.secret))
		.update(`${args.id}.${args.timestamp}.${args.body}`)
		.digest('base64')

/**
 * Build the `webhook-signature` value: each signature tagged with its scheme version, space
 * separated. During a rotation grace period the active secret's signature comes first, but
 * receivers are expected to accept any listed signature.
 */
export const signatureHeader = (signatures: string[]): string =>
	signatures.map((signature) => `${SIGNATURE_VERSION},${signature}`).join(' ')
