import { describe, expect, it } from 'vitest'

import { impersonatorRelationship } from './impersonator'

const user = (impersonator: unknown) => ({
	id: 'target',
	collection: 'users',
	_impersonation: { impersonator },
})

describe('impersonatorRelationship', () => {
	it('returns nothing when the request is not impersonated', () => {
		expect(impersonatorRelationship(undefined, false)).toBeUndefined()
		expect(impersonatorRelationship({ id: 'target' }, false)).toBeUndefined()
		expect(impersonatorRelationship(user(undefined), false)).toBeUndefined()
	})

	it('drops an impersonator that is not a collection and id', () => {
		expect(impersonatorRelationship(user({ id: 'admin' }), false)).toBeUndefined()
		expect(impersonatorRelationship(user({ collection: 'users' }), false)).toBeUndefined()
		expect(impersonatorRelationship(user({ collection: '', id: 'admin' }), false)).toBeUndefined()
	})

	it('stores an id, or a polymorphic relation when the host has several auth collections', () => {
		expect(impersonatorRelationship(user({ collection: 'users', id: 'admin' }), false)).toBe(
			'admin'
		)
		expect(impersonatorRelationship(user({ collection: 'users', id: 7 }), true)).toEqual({
			relationTo: 'users',
			value: 7,
		})
	})
})
