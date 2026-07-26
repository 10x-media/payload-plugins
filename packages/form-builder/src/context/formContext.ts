import { createHmac, timingSafeEqual } from 'node:crypto'
import type { Payload } from 'payload'

/** A verified reference to the document a form was rendered for. Never a secret: the id is already public. */
export type FormContextReference = { relationTo: string; value: string | number }

const VERSION = 'v1'
const DEFAULT_EXPIRES_IN_SECONDS = 86_400

const hmacHex = (body: string, secret: string): string =>
	createHmac('sha256', secret).update(body).digest('hex')

/**
 * Sign a `{ relationTo, value }` reference into a compact `v1.<base64url(payload)>.<hmac>` token: a
 * rendering surface mints one per document it renders a form for, the client carries it, and the plugin
 * verifies it on submit. Signed (HMAC-SHA256 over the payload with `secret ?? payload.secret`), not
 * encrypted: the reference is not a secret, the signature only stops rewriting. `expiresIn` (seconds,
 * default one day) bounds replay.
 */
export const signFormContext = (args: {
	payload: Payload
	relationTo: string
	value: string | number
	expiresIn?: number
	secret?: string
}): string => {
	const { payload, relationTo, value, expiresIn, secret } = args
	const exp = Math.floor(Date.now() / 1000) + (expiresIn ?? DEFAULT_EXPIRES_IN_SECONDS)
	const body = Buffer.from(JSON.stringify({ relationTo, value, exp })).toString('base64url')
	return `${VERSION}.${body}.${hmacHex(body, secret ?? payload.secret)}`
}

/**
 * Verify a token minted by `signFormContext` and return its reference, or null on any failure (wrong
 * version, malformed, bad signature, or expired). Never throws, and the signature check is constant-time.
 */
export const verifyFormContext = (
	token: string,
	secret: string,
	nowMs: number = Date.now()
): FormContextReference | null => {
	const parts = token.split('.')
	if (parts.length !== 3 || parts[0] !== VERSION) {
		return null
	}
	const [, body, signature] = parts
	const expected = hmacHex(body ?? '', secret)
	const given = Buffer.from(signature ?? '')
	const want = Buffer.from(expected)
	if (given.byteLength !== want.byteLength || !timingSafeEqual(given, want)) {
		return null
	}
	let parsed: unknown
	try {
		parsed = JSON.parse(Buffer.from(body ?? '', 'base64url').toString('utf8'))
	} catch {
		return null
	}
	if (!parsed || typeof parsed !== 'object') {
		return null
	}
	const { relationTo, value, exp } = parsed as Record<string, unknown>
	if (typeof relationTo !== 'string' || relationTo.length === 0) {
		return null
	}
	if (typeof value !== 'string' && typeof value !== 'number') {
		return null
	}
	if (typeof exp !== 'number' || exp * 1000 <= nowMs) {
		return null
	}
	return { relationTo, value }
}
