import { describe, expect, it } from 'vitest'
import { generateSecret } from '../secrets/format'
import {
	decideDelivery,
	fromCollectionRow,
	type SecretSlot,
	withinGrace,
} from './resolveSubscriptions'

const NOW = Date.parse('2026-01-01T00:00:00.000Z')
const current = generateSecret()
const previous = generateSecret()

const ok = (secret: string): SecretSlot => ({ secret, state: 'ok' })
const ABSENT: SecretSlot = { secret: null, state: 'absent' }
const unusable = (reason: string): SecretSlot => ({ reason, secret: null, state: 'unusable' })

/**
 * `withinGrace` is what decides whether the retired slot is decrypted at all, so the window's
 * edges are pinned here rather than through a full row resolve. Its two input shapes both occur
 * in practice: Mongo hands the timestamp back as an ISO string and the SQL adapters as a `Date`.
 */
describe('rotation grace window', () => {
	it('is open before the expiry instant', () => {
		expect(withinGrace(new Date(NOW + 60_000).toISOString(), NOW)).toBe(true)
	})

	it('is closed after it', () => {
		expect(withinGrace(new Date(NOW - 1).toISOString(), NOW)).toBe(false)
	})

	it('treats the expiry instant itself as closed', () => {
		expect(withinGrace(new Date(NOW).toISOString(), NOW)).toBe(false)
	})

	it('accepts a Date expiry as the SQL adapters return it', () => {
		expect(withinGrace(new Date(NOW + 60_000), NOW)).toBe(true)
		expect(withinGrace(new Date(NOW - 1), NOW)).toBe(false)
	})

	it('is closed with no expiry recorded, rather than open forever', () => {
		expect(withinGrace(null, NOW)).toBe(false)
		expect(withinGrace(undefined, NOW)).toBe(false)
	})

	it('is closed for an unparseable expiry, rather than open forever', () => {
		expect(withinGrace('not-a-date', NOW)).toBe(false)
	})
})

describe('unusable secrets', () => {
	it('flags a row whose active secret could not be recovered', () => {
		const resolved = fromCollectionRow(
			{ id: 1, url: 'https://x' },
			{ active: unusable('no key authenticates it'), retired: ABSENT }
		)
		expect(resolved.secretUnusable).toBe(true)
		expect(resolved.secrets).toEqual([])
		expect(resolved.secretUnusableReason).toBe('no key authenticates it')
	})

	/**
	 * The retired slot is tracked separately on purpose. Folding it into `secretUnusable` would let
	 * an unreadable secret nobody needs any more block deliveries the current secret signs fine,
	 * trading a correctly signed delivery for none at all.
	 */
	it('drops an unusable retired secret without failing the delivery', () => {
		const resolved = fromCollectionRow(
			{ id: 1, url: 'https://x' },
			{ active: ok(current), retired: unusable('corrupt') }
		)
		expect(resolved.secretUnusable).toBe(false)
		expect(resolved.retiredSecretUnusable).toBe(true)
		expect(resolved.retiredSecretUnusableReason).toBe('corrupt')
		expect(resolved.secrets).toEqual([current])
		expect(decideDelivery(resolved).deliverable).toBe(true)
	})

	it('still refuses when the active secret is the unusable one, whatever the retired slot holds', () => {
		const resolved = fromCollectionRow(
			{ id: 1, url: 'https://x' },
			{ active: unusable('corrupt'), retired: ok(previous) }
		)
		expect(resolved.secretUnusable).toBe(true)
		expect(resolved.secrets).toEqual([previous])
		expect(decideDelivery(resolved).deliverable).toBe(false)
	})

	it('does not flag a subscription that simply has no secret', () => {
		const resolved = fromCollectionRow(
			{ id: 1, url: 'https://x' },
			{ active: ABSENT, retired: ABSENT }
		)
		expect(resolved.secretUnusable).toBe(false)
		expect(resolved.secretHidden).toBe(false)
		expect(resolved.secrets).toEqual([])
		expect(decideDelivery(resolved).deliverable).toBe(true)
	})

	/**
	 * A hidden active secret means the subscription was resolved without opening the raw window,
	 * so the ciphertext was stripped from the row on its way out. The secret exists and was simply
	 * not asked for, so this must refuse rather than fall through to the unsigned path a genuinely
	 * secretless subscription takes.
	 */
	it('refuses a hidden active secret rather than delivering it unsigned', () => {
		const resolved = fromCollectionRow(
			{ id: 1, url: 'https://x' },
			{ active: { secret: null, state: 'hidden' }, retired: ABSENT }
		)
		expect(resolved.secretHidden).toBe(true)
		expect(resolved.secretUnusable).toBe(false)
		expect(resolved.secrets).toEqual([])
		const decision = decideDelivery(resolved)
		expect(decision.deliverable).toBe(false)
		expect(decision.deliverable === false && decision.reason).toMatch(/not read for signing/)
	})
})

describe('decideDelivery', () => {
	const base = fromCollectionRow(
		{ id: 1, url: 'https://x' },
		{ active: ok(current), retired: ABSENT }
	)

	it('allows a healthy subscription and narrows it', () => {
		const decision = decideDelivery(base)
		expect(decision.deliverable).toBe(true)
		if (decision.deliverable) {
			expect(decision.subscription.secrets).toEqual([current])
		}
	})

	it('refuses a missing or disabled subscription', () => {
		expect(decideDelivery(null)).toMatchObject({ reason: 'subscription not found' })
		expect(decideDelivery({ ...base, enabled: false })).toMatchObject({
			reason: 'subscription disabled',
		})
	})
})
