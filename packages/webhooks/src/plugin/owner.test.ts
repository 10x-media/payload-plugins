import type { PayloadRequest } from 'payload'
import { describe, expect, it } from 'vitest'
import type { SubscriptionOwner, SubscriptionOwnership } from '../options'
import { canActAsOwner, ownerStamp, sameOwner } from './owner'

const ownership: SubscriptionOwnership = { resolve: () => null }
const alice: SubscriptionOwner = { user: { id: 1, collection: 'users' } }
const as = (user: unknown) => ({ user }) as unknown as PayloadRequest

describe('canActAsOwner', () => {
	it('lets trusted server code name any owner', async () => {
		expect(await canActAsOwner({ ownership, owner: alice, req: as(null), trusted: true })).toBe(
			true
		)
		expect(
			await canActAsOwner({ ownership, owner: { global: true }, req: as(null), trusted: true })
		).toBe(true)
	})

	/** No user is not the same as trusted: an anonymous REST caller has none either. */
	it('refuses a caller with no user who is not trusted server code', async () => {
		expect(await canActAsOwner({ ownership, owner: alice, req: as(null), trusted: false })).toBe(
			false
		)
	})

	it('lets a user act as themselves and as nobody else, never as the global owner', async () => {
		const self = as({ id: 1, collection: 'users' })
		expect(await canActAsOwner({ ownership, owner: alice, req: self, trusted: false })).toBe(true)
		const other = as({ id: 2, collection: 'users' })
		expect(await canActAsOwner({ ownership, owner: alice, req: other, trusted: false })).toBe(false)
		expect(
			await canActAsOwner({ ownership, owner: { global: true }, req: self, trusted: false })
		).toBe(false)
	})

	it('hands the decision to canActAs when the application supplies one', async () => {
		const permissive: SubscriptionOwnership = { resolve: () => null, canActAs: () => true }
		const other = as({ id: 2, collection: 'users' })
		expect(
			await canActAsOwner({ ownership: permissive, owner: alice, req: other, trusted: false })
		).toBe(true)
	})
})

describe('sameOwner and ownerStamp', () => {
	it('tells owners apart by id and collection', () => {
		expect(sameOwner(alice, { user: { id: '1', collection: 'users' } })).toBe(true)
		expect(sameOwner(alice, { user: { id: 1, collection: 'customers' } })).toBe(false)
		expect(sameOwner(alice, { global: true })).toBe(false)
		expect(sameOwner(null, null)).toBe(true)
		expect(sameOwner(alice, null)).toBe(false)
	})

	it('stamps a user owner and leaves a global one unstamped', () => {
		expect(ownerStamp(alice)).toEqual({ ownerId: '1', ownerCollection: 'users' })
		expect(ownerStamp({ global: true })).toEqual({})
		expect(ownerStamp(null)).toEqual({})
	})
})
