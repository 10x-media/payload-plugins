import { describe, expect, it } from 'vitest'

import { actingUserRef, impersonatorRef } from './userRef'

const user = (impersonator: unknown) => ({
	id: 'target',
	collection: 'users',
	_impersonation: { impersonator },
})

describe('actingUserRef', () => {
	it('stores the collection and the id as text', () => {
		expect(actingUserRef({ collection: 'admins', id: 7 })).toEqual({
			relationTo: 'admins',
			value: '7',
		})
	})

	it('returns nothing without a user or its collection', () => {
		expect(actingUserRef(undefined)).toBeUndefined()
		expect(actingUserRef(null)).toBeUndefined()
		expect(actingUserRef({ id: 'u1' })).toBeUndefined()
	})
})

describe('impersonatorRef', () => {
	it('returns nothing when the request is not impersonated', () => {
		expect(impersonatorRef(undefined)).toBeUndefined()
		expect(impersonatorRef({ id: 'target' })).toBeUndefined()
		expect(impersonatorRef(user(undefined))).toBeUndefined()
	})

	it('drops an impersonator that is not a collection and id', () => {
		expect(impersonatorRef(user({ id: 'admin' }))).toBeUndefined()
		expect(impersonatorRef(user({ collection: 'users' }))).toBeUndefined()
		expect(impersonatorRef(user({ collection: '', id: 'admin' }))).toBeUndefined()
	})

	it('stores the impersonator as the same text pair as the user', () => {
		expect(impersonatorRef(user({ collection: 'users', id: 7 }))).toEqual({
			relationTo: 'users',
			value: '7',
		})
	})
})
