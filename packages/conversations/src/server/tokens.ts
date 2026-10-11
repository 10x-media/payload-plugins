import { createHmac, timingSafeEqual } from 'node:crypto'

/** What a subscription token vouches for. */
export type SubscriptionClaims = {
	/** Channels of `key` the user could read when the token was issued. */
	channels: string[]
	/** Expiry, epoch milliseconds. */
	exp: number
	instance: string
	key: string
	userKey: string
}

export const TOKEN_TTL_MS = 10 * 60 * 1000

const encode = (value: Buffer | string) => Buffer.from(value).toString('base64url')

const sign = (secret: string, payload: string) =>
	createHmac('sha256', `conversations:${secret}`).update(payload).digest()

/**
 * A subscription token: an HMAC-signed claim that the user passed access for
 * one key at issue time. The poll endpoint trusts it until `exp` without
 * touching the database, so revocation reaches change signals within the TTL;
 * message loads always run full access.
 */
export const signToken = (secret: string, claims: SubscriptionClaims): string => {
	const payload = encode(
		JSON.stringify([claims.instance, claims.userKey, claims.key, claims.channels, claims.exp])
	)
	return `${payload}.${encode(sign(secret, payload))}`
}

/** The claims of a valid, unexpired token, or null. */
export const verifyToken = (
	secret: string,
	token: unknown,
	now: number = Date.now()
): SubscriptionClaims | null => {
	if (typeof token !== 'string' || token.length > 4096) {
		return null
	}
	const [payload, signature, extra] = token.split('.')
	if (!payload || !signature || extra !== undefined) {
		return null
	}
	const expected = sign(secret, payload)
	const given = Buffer.from(signature, 'base64url')
	if (given.length !== expected.length || !timingSafeEqual(given, expected)) {
		return null
	}
	try {
		const [instance, userKey, key, channels, exp] = JSON.parse(
			Buffer.from(payload, 'base64url').toString('utf8')
		) as [unknown, unknown, unknown, unknown, unknown]
		if (
			typeof instance !== 'string' ||
			typeof userKey !== 'string' ||
			typeof key !== 'string' ||
			!Array.isArray(channels) ||
			!channels.every((channel) => typeof channel === 'string') ||
			typeof exp !== 'number' ||
			exp <= now
		) {
			return null
		}
		return { channels, exp, instance, key, userKey }
	} catch {
		return null
	}
}
