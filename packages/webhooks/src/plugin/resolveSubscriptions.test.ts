import { describe, expect, it } from 'vitest'
import { SECRET_PREFIX } from '../constants'
import { generateSecret } from '../secrets/format'
import {
	decideDelivery,
	fromCodeSubscription,
	fromCollectionRow,
	matchSubscriptions,
	plaintextSlot,
	type SecretSlot,
} from './resolveSubscriptions'

const ABSENT: SecretSlot = { secret: null, state: 'absent' }

describe('plaintextSlot', () => {
	it('normalizes a bare base64 secret onto the whsec_ form', () => {
		const bare = generateSecret().slice(SECRET_PREFIX.length)
		expect(plaintextSlot(bare)).toEqual({ secret: `${SECRET_PREFIX}${bare}`, state: 'ok' })
	})

	it('reads an empty or missing value as absent, not as unusable', () => {
		expect(plaintextSlot('').state).toBe('absent')
		expect(plaintextSlot(undefined).state).toBe('absent')
		expect(plaintextSlot(null).state).toBe('absent')
	})

	it('reports why a malformed secret cannot sign', () => {
		const slot = plaintextSlot('whsec_not base64!')
		expect(slot.state).toBe('unusable')
		expect(slot.state === 'unusable' && slot.reason).toMatch(/base64/)
	})
})

describe('fromCollectionRow', () => {
	const secret = generateSecret()

	it('normalizes ids, headers, and defaults enabled to true', () => {
		const r = fromCollectionRow(
			{
				id: 7,
				url: 'https://x',
				events: ['posts.created'],
				headers: [
					{ key: 'X-A', value: '1' },
					{ key: '', value: 'skip' },
				],
				enabled: null,
			},
			{ active: { secret, state: 'ok' }, retired: ABSENT }
		)
		expect(r).toEqual({
			id: '7',
			source: 'collection',
			url: 'https://x',
			events: ['posts.created'],
			secrets: [secret],
			secretUnusable: false,
			secretUnusableReason: undefined,
			retiredSecretUnusable: false,
			retiredSecretUnusableReason: undefined,
			secretHidden: false,
			headers: { 'X-A': '1' },
			enabled: true,
		})
	})

	it('carries the active secret first and the retired one after it', () => {
		const retired = generateSecret()
		const r = fromCollectionRow(
			{ id: 1, url: 'u' },
			{ active: { secret, state: 'ok' }, retired: { secret: retired, state: 'ok' } }
		)
		expect(r.secrets).toEqual([secret, retired])
	})

	it('yields no secrets when neither slot holds one', () => {
		expect(
			fromCollectionRow({ id: 1, url: 'u' }, { active: ABSENT, retired: ABSENT }).secrets
		).toEqual([])
	})
})

describe('decideDelivery', () => {
	const base = fromCollectionRow(
		{ id: 1, url: 'u', events: ['posts.created'] },
		{ active: ABSENT, retired: ABSENT }
	)

	it('delivers a subscription with no secret at all, unsigned', () => {
		expect(decideDelivery(base).deliverable).toBe(true)
	})

	it('refuses an unusable active secret, and says which fix it needs', () => {
		const sub = fromCollectionRow(
			{ id: 1, url: 'u' },
			{
				active: { reason: 'the ring is missing its key', secret: null, state: 'unusable' },
				retired: ABSENT,
			}
		)
		const decision = decideDelivery(sub)
		expect(decision.deliverable).toBe(false)
		expect(decision.deliverable === false && decision.reason).toContain(
			'the ring is missing its key'
		)
	})

	it('refuses a secret that was never read for signing rather than sending unsigned', () => {
		const sub = fromCollectionRow(
			{ id: 1, url: 'u' },
			{ active: { secret: null, state: 'hidden' }, retired: ABSENT }
		)
		const decision = decideDelivery(sub)
		expect(decision.deliverable).toBe(false)
		expect(decision.deliverable === false && decision.reason).toMatch(/not read for signing/)
	})

	it('still delivers when only the retired secret is unusable', () => {
		const sub = fromCollectionRow(
			{ id: 1, url: 'u' },
			{
				active: { secret: generateSecret(), state: 'ok' },
				retired: { reason: 'corrupt', secret: null, state: 'unusable' },
			}
		)
		expect(decideDelivery(sub).deliverable).toBe(true)
		expect(sub.retiredSecretUnusable).toBe(true)
	})
})

describe('fromCodeSubscription', () => {
	it('defaults enabled to true', () => {
		expect(fromCodeSubscription({ id: 'c', url: 'https://y', events: [] }).enabled).toBe(true)
		expect(
			fromCodeSubscription({ id: 'c', url: 'https://y', events: [], enabled: false }).enabled
		).toBe(false)
	})

	it('normalizes a bare base64 secret onto the whsec_ form', () => {
		const bare = generateSecret().slice(SECRET_PREFIX.length)
		expect(fromCodeSubscription({ id: 'c', url: 'u', events: [], secret: bare }).secrets).toEqual([
			`${SECRET_PREFIX}${bare}`,
		])
	})

	it('yields no secrets when none is configured', () => {
		expect(fromCodeSubscription({ id: 'c', url: 'u', events: [] }).secrets).toEqual([])
	})

	it('is never hidden: a code secret is already in the clear', () => {
		expect(fromCodeSubscription({ id: 'c', url: 'u', events: [] }).secretHidden).toBe(false)
	})
})

describe('matchSubscriptions', () => {
	const subs = [
		fromCodeSubscription({ id: 'a', url: 'u', events: ['posts.created'] }),
		fromCodeSubscription({ id: 'b', url: 'u', events: ['posts.updated'] }),
		fromCodeSubscription({ id: 'c', url: 'u', events: ['posts.created'], enabled: false }),
	]
	it('returns enabled subs listening for the event', () => {
		expect(matchSubscriptions(subs, 'posts.created').map((s) => s.id)).toEqual(['a'])
	})
})
