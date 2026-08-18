import { describe, expect, it } from 'vitest'
import { SECRET_MASK, SECRET_UNUSABLE } from '../constants'
import { generateSecret } from '../secrets/format'
import { decideDelivery, fromCollectionRow } from './resolveSubscriptions'

const NOW = Date.parse('2026-01-01T00:00:00.000Z')
const current = generateSecret()
const previous = generateSecret()

const row = (overrides: Record<string, unknown> = {}) => ({
	id: 1,
	url: 'https://x',
	secret: current,
	previousSecret: previous,
	...overrides,
})

describe('rotation grace window', () => {
	it('signs with both secrets while the window is open, active first', () => {
		const resolved = fromCollectionRow(
			row({ previousSecretExpiresAt: new Date(NOW + 60_000).toISOString() }),
			NOW
		)
		expect(resolved.secrets).toEqual([current, previous])
	})

	it('drops the previous secret once the window closes', () => {
		const resolved = fromCollectionRow(
			row({ previousSecretExpiresAt: new Date(NOW - 1).toISOString() }),
			NOW
		)
		expect(resolved.secrets).toEqual([current])
	})

	it('treats the expiry instant itself as closed', () => {
		const resolved = fromCollectionRow(
			row({ previousSecretExpiresAt: new Date(NOW).toISOString() }),
			NOW
		)
		expect(resolved.secrets).toEqual([current])
	})

	it('accepts a Date expiry as stored by postgres drivers', () => {
		const resolved = fromCollectionRow(
			row({ previousSecretExpiresAt: new Date(NOW + 60_000) }),
			NOW
		)
		expect(resolved.secrets).toEqual([current, previous])
	})

	it('ignores a previous secret with no expiry', () => {
		expect(fromCollectionRow(row({ previousSecretExpiresAt: null }), NOW).secrets).toEqual([
			current,
		])
		expect(fromCollectionRow(row(), NOW).secrets).toEqual([current])
	})

	it('ignores an unparseable expiry rather than signing forever', () => {
		const resolved = fromCollectionRow(row({ previousSecretExpiresAt: 'not-a-date' }), NOW)
		expect(resolved.secrets).toEqual([current])
	})

	it('drops a masked previous secret inside an open window', () => {
		const resolved = fromCollectionRow(
			row({
				previousSecret: '__redacted__',
				previousSecretExpiresAt: new Date(NOW + 60_000).toISOString(),
			}),
			NOW
		)
		expect(resolved.secrets).toEqual([current])
	})

	it('still signs with the previous secret when the current one is unreadable', () => {
		const resolved = fromCollectionRow(
			row({ secret: null, previousSecretExpiresAt: new Date(NOW + 60_000).toISOString() }),
			NOW
		)
		expect(resolved.secrets).toEqual([previous])
	})
})

describe('unusable secrets', () => {
	it('flags a row whose secret could not be decrypted', () => {
		const resolved = fromCollectionRow(row({ secret: SECRET_UNUSABLE }), NOW)
		expect(resolved.secretUnusable).toBe(true)
		expect(resolved.secrets).toEqual([])
	})

	/**
	 * The retired slot is tracked separately on purpose. Folding it into `secretUnusable` would let
	 * an unreadable secret nobody needs any more block deliveries the current secret signs fine,
	 * trading a correctly signed delivery for none at all.
	 */
	it('drops an unusable previous secret inside an open window without failing the delivery', () => {
		const resolved = fromCollectionRow(
			row({
				previousSecret: SECRET_UNUSABLE,
				previousSecretExpiresAt: new Date(NOW + 60_000).toISOString(),
			}),
			NOW
		)
		expect(resolved.secretUnusable).toBe(false)
		expect(resolved.retiredSecretUnusable).toBe(true)
		expect(resolved.secrets).toEqual([current])
		expect(decideDelivery(resolved).deliverable).toBe(true)
	})

	it('ignores an unusable previous secret whose window already closed', () => {
		const resolved = fromCollectionRow(
			row({
				previousSecret: SECRET_UNUSABLE,
				previousSecretExpiresAt: new Date(NOW - 1).toISOString(),
			}),
			NOW
		)
		expect(resolved.secretUnusable).toBe(false)
		expect(resolved.retiredSecretUnusable).toBe(false)
		expect(resolved.secrets).toEqual([current])
	})

	it('still refuses when the active secret is the unusable one, whatever the retired slot holds', () => {
		const resolved = fromCollectionRow(
			row({
				secret: SECRET_UNUSABLE,
				previousSecretExpiresAt: new Date(NOW + 60_000).toISOString(),
			}),
			NOW
		)
		expect(resolved.secretUnusable).toBe(true)
		expect(resolved.secrets).toEqual([previous])
		expect(decideDelivery(resolved).deliverable).toBe(false)
	})

	it('flags a retired secret that will not normalize, like the sentinel', () => {
		const resolved = fromCollectionRow(
			row({
				previousSecret: 'not base64!',
				previousSecretExpiresAt: new Date(NOW + 60_000).toISOString(),
			}),
			NOW
		)
		expect(resolved.retiredSecretUnusable).toBe(true)
		expect(resolved.secretUnusable).toBe(false)
		expect(resolved.secrets).toEqual([current])
	})

	it('flags a legacy plaintext secret that will not normalize', () => {
		const resolved = fromCollectionRow(row({ secret: 'not base64!' }), NOW)
		expect(resolved.secretUnusable).toBe(true)
	})

	it('does not flag a subscription that simply has no secret', () => {
		const resolved = fromCollectionRow({ id: 1, url: 'https://x' }, NOW)
		expect(resolved.secretUnusable).toBe(false)
		expect(resolved.secrets).toEqual([])
	})

	/**
	 * A masked active secret means the subscription was resolved without opening the signing
	 * reveal window. The secret exists and was simply not asked for, so this must refuse rather
	 * than fall through to the unsigned path a genuinely secretless subscription takes.
	 */
	it('refuses a masked active secret rather than delivering it unsigned', () => {
		const resolved = fromCollectionRow(row({ secret: SECRET_MASK }), NOW)
		expect(resolved.secretMasked).toBe(true)
		expect(resolved.secretUnusable).toBe(false)
		expect(resolved.secrets).toEqual([])
		const decision = decideDelivery(resolved)
		expect(decision.deliverable).toBe(false)
		expect(decision.deliverable === false && decision.reason).toMatch(/not revealed for signing/)
	})

	it('leaves a genuinely secretless subscription deliverable and unsigned', () => {
		const resolved = fromCollectionRow({ id: 3, url: 'https://x' }, NOW)
		expect(resolved.secretMasked).toBe(false)
		expect(resolved.secrets).toEqual([])
		expect(decideDelivery(resolved).deliverable).toBe(true)
	})
})

describe('decideDelivery', () => {
	const base = fromCollectionRow(row({ previousSecretExpiresAt: null }), NOW)

	it('allows a healthy subscription and narrows it', () => {
		const decision = decideDelivery(base)
		expect(decision.deliverable).toBe(true)
		if (decision.deliverable) {
			expect(decision.subscription.secrets).toEqual([current])
		}
	})

	it('refuses a subscription whose secret cannot be decrypted', () => {
		const decision = decideDelivery({ ...base, secretUnusable: true })
		expect(decision).toEqual({
			deliverable: false,
			reason: 'signing secret could not be decrypted; refused rather than sent unsigned',
		})
	})

	it('refuses a missing or disabled subscription', () => {
		expect(decideDelivery(null)).toMatchObject({ reason: 'subscription not found' })
		expect(decideDelivery({ ...base, enabled: false })).toMatchObject({
			reason: 'subscription disabled',
		})
	})

	it('allows an unsigned subscription that has no secret at all', () => {
		const unsigned = fromCollectionRow({ id: 2, url: 'https://x' }, NOW)
		expect(decideDelivery(unsigned).deliverable).toBe(true)
	})
})
