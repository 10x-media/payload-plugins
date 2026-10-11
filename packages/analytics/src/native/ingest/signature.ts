import { createHmac, timingSafeEqual } from 'node:crypto'
import { ITEM_SIGNATURE_LENGTH } from '../../goals/constants'

/**
 * Derives a secret's key for the one use `label` names, so it can never stand in for any other
 * use of the secret. Each secret's key is derived once.
 */
export const labelledKey = (label: string): ((secret: string) => Buffer) => {
	const keysBySecret = new Map<string, Buffer>()
	return (secret) => {
		const known = keysBySecret.get(secret)
		if (known) {
			return known
		}
		const key = createHmac('sha256', secret).update(label).digest()
		keysBySecret.set(secret, key)
		return key
	}
}

/** The signature a page carries for `message`: 72 bits of its HMAC under `key`, base64url. */
export const shortSignature = (key: Buffer, message: string): string =>
	createHmac('sha256', key).update(message).digest('base64url').slice(0, ITEM_SIGNATURE_LENGTH)

/** Whether `given` is `expected`, compared in constant time. */
export const sameSignature = (expected: string, given: string): boolean => {
	const expectedBytes = Buffer.from(expected)
	const givenBytes = Buffer.from(given)
	return expectedBytes.length === givenBytes.length && timingSafeEqual(expectedBytes, givenBytes)
}
