import { describe, expect, it } from 'vitest'
import { castCancelledWhere } from './castCancelledQuery'

describe('castCancelledWhere', () => {
	it('casts string booleans on error.cancelled at any depth', () => {
		expect(
			castCancelledWhere({
				or: [
					{
						and: [
							{ hasError: { equals: 'true' } },
							{ 'error.cancelled': { equals: 'true' } },
							{ 'error.cancelled': { not_equals: 'false' } },
						],
					},
				],
			})
		).toEqual({
			or: [
				{
					and: [
						{ hasError: { equals: 'true' } },
						{ 'error.cancelled': { equals: true } },
						{ 'error.cancelled': { not_equals: false } },
					],
				},
			],
		})
	})

	it('leaves other operators and values alone', () => {
		const where = { 'error.cancelled': { exists: 'false' }, 'error.message': { equals: 'true' } }
		expect(castCancelledWhere(where)).toEqual(where)
	})
})
