import { describe, expect, it } from 'vitest'

import { resolveTargetFilters } from './filterTargets'

const req = { payload: {}, user: { id: '1' } } as never

describe('resolveTargetFilters', () => {
	it('allows every collection when filterTargets is unset', async () => {
		const map = await resolveTargetFilters({
			collections: ['users', 'members'],
			options: { access: { impersonate: () => true } } as never,
			req,
		})
		expect(map).toEqual({ members: true, users: true })
	})

	it('drops collections that return false', async () => {
		const map = await resolveTargetFilters({
			collections: ['users', 'members'],
			options: {
				access: {
					filterTargets: ({ targetCollection }: { targetCollection: string }) =>
						targetCollection === 'members',
					impersonate: () => true,
				},
			} as never,
			req,
		})
		expect(map).toEqual({ members: true })
	})

	it('stores a Where for a filtered collection', async () => {
		const where = { roles: { not_in: ['admin'] } }
		const map = await resolveTargetFilters({
			collections: ['users'],
			options: {
				access: {
					filterTargets: () => where,
					impersonate: () => true,
				},
			} as never,
			req,
		})
		expect(map).toEqual({ users: where })
	})
})
