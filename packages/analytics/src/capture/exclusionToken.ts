import { createHash, createHmac } from 'node:crypto'

/** What every exclusion token signs, ahead of the scope it belongs to. */
const EXCLUSION_CONTEXT = 'analytics:exclusion:'

/**
 * One scope's exclusion token, `HMAC-SHA256(secret, context + scope)` as base64url: only the
 * server can make one, and it does nothing on another scope's sites.
 */
export const exclusionToken = (secret: string, scope: string | null): string =>
	createHmac('sha256', secret)
		.update(`${EXCLUSION_CONTEXT}${scope ?? ''}`)
		.digest('base64url')

/**
 * The SHA-256 of `text` as lowercase hex: what the public tracker config carries in place of a
 * value a page may check with `crypto.subtle` but must never read.
 */
export const publicDigest = (text: string): string =>
	createHash('sha256').update(text).digest('hex')

/**
 * What the public tracker config carries in place of the token: its {@link publicDigest}. The
 * tracker can check a link against it but never mint one.
 */
export const exclusionTokenHash = (token: string): string => publicDigest(token)
