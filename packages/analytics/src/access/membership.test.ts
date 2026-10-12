import type { PayloadRequest, TypedUser } from 'payload'
import { describe, expect, it, vi } from 'vitest'
import { isScopeMember, tenantMembership, userTenantIds } from './membership'

const reqOf = (user: Record<string, unknown> | null): PayloadRequest =>
	({ user, payload: { logger: { warn: vi.fn() } } }) as unknown as PayloadRequest

describe('userTenantIds', () => {
	it('reads tenant ids stored as plain ids, numbers included', () => {
		const user = { tenants: [{ tenant: 'alpha' }, { tenant: 7 }] }
		expect(userTenantIds(user)).toEqual(['alpha', '7'])
	})

	it('reads populated tenant relationships by their id', () => {
		const user = { tenants: [{ tenant: { id: 'alpha', name: 'Alpha' } }, { tenant: { id: 7 } }] }
		expect(userTenantIds(user)).toEqual(['alpha', '7'])
	})

	it('skips a row without a tenant, and reads nothing from a user without the array', () => {
		expect(userTenantIds({ tenants: [{ tenant: null }, {}, { tenant: 'beta' }] })).toEqual(['beta'])
		expect(userTenantIds({ tenants: 'alpha' })).toEqual([])
		expect(userTenantIds({})).toEqual([])
		expect(userTenantIds(null)).toEqual([])
	})

	it('reads the field names it is given', () => {
		const user = { sites: [{ site: { id: 'alpha' } }], tenants: [{ tenant: 'beta' }] }
		expect(userTenantIds(user, 'sites', 'site')).toEqual(['alpha'])
	})
})

describe('tenantMembership', () => {
	const member = tenantMembership()

	it('admits a user to the tenants in their own array, and to no other', async () => {
		const req = reqOf({ id: 1, collection: 'users', tenants: [{ tenant: 'alpha' }] })
		expect(await member({ req, scope: 'alpha' })).toBe(true)
		expect(await member({ req, scope: 'beta' })).toBe(false)
	})

	it('compares as strings, so a numeric tenant id matches its scope', async () => {
		const req = reqOf({ id: 1, collection: 'users', tenants: [{ tenant: { id: 42 } }] })
		expect(await member({ req, scope: '42' })).toBe(true)
	})

	it('admits nobody without a user', async () => {
		expect(await member({ req: reqOf(null), scope: 'alpha' })).toBe(false)
	})

	it('admits the users userHasAccessToAllTenants names to every tenant', async () => {
		const staff = (user: TypedUser): boolean => user.roles?.includes('moderator') === true
		const membership = tenantMembership({ userHasAccessToAllTenants: staff })
		const moderator = reqOf({ id: 1, collection: 'users', roles: ['moderator'], tenants: [] })
		const editor = reqOf({ id: 2, collection: 'users', roles: ['editor'], tenants: [] })
		expect(await membership({ req: moderator, scope: 'beta' })).toBe(true)
		expect(await membership({ req: editor, scope: 'beta' })).toBe(false)
	})

	it('reads custom field names, as the multi-tenant plugin can be configured', async () => {
		const membership = tenantMembership({
			tenantsArrayFieldName: 'sites',
			tenantsArrayTenantFieldName: 'site',
		})
		const req = reqOf({ id: 1, collection: 'users', sites: [{ site: 'alpha' }] })
		expect(await membership({ req, scope: 'alpha' })).toBe(true)
	})
})

describe('isScopeMember', () => {
	it('asks once per request, scope and user', async () => {
		const member = vi.fn(() => true)
		const req = reqOf({ id: 1, collection: 'users' })
		await isScopeMember(member, req, 'alpha')
		await isScopeMember(member, req, 'alpha')
		await isScopeMember(member, req, 'beta')
		expect(member).toHaveBeenCalledTimes(2)
	})

	// A Local API call reusing a request may put a different user on it.
	it('asks again for another user on the same request', async () => {
		const member = vi.fn(() => true)
		const req = reqOf({ id: 1, collection: 'users' })
		await isScopeMember(member, req, 'alpha')
		req.user = { id: 2, collection: 'users' } as PayloadRequest['user']
		await isScopeMember(member, req, 'alpha')
		expect(member).toHaveBeenCalledTimes(2)
	})

	it('admits nobody without a membership check, and nobody whose check throws', async () => {
		const req = reqOf({ id: 1, collection: 'users' })
		expect(await isScopeMember(undefined, req, 'alpha')).toBe(false)
		const broken = () => {
			throw new Error('boom')
		}
		expect(await isScopeMember(broken, req, 'alpha')).toBe(false)
	})
})
