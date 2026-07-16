import { describe, expect, it } from 'vitest'

/** Mirrors the OAuth callback nonce check in sipgate.oauth.ts. */
const isValidOAuthNonce = (
	nonce: { userId: string; exp: number } | null | undefined
): nonce is { userId: string; exp: number } => Boolean(nonce && nonce.exp >= Date.now())

describe('OAuth nonce TTL', () => {
	it('accepts a non-expired nonce', () => {
		expect(isValidOAuthNonce({ userId: 'u1', exp: Date.now() + 60_000 })).toBe(true)
	})

	it('rejects a missing nonce', () => {
		expect(isValidOAuthNonce(null)).toBe(false)
		expect(isValidOAuthNonce(undefined)).toBe(false)
	})

	it('rejects an expired nonce', () => {
		expect(isValidOAuthNonce({ userId: 'u1', exp: Date.now() - 1 })).toBe(false)
	})
})
