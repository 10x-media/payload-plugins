import type { PayloadRequest } from 'payload'
import { describe, expect, it } from 'vitest'

import { multiTenantScope } from './multiTenantScope'
import { SCOPE_WILDCARD } from './types'

const req = (opts: {
	cookie?: string
	user?: unknown
	idType?: 'text' | 'number'
}): PayloadRequest =>
	({
		headers: new Headers(opts.cookie ? { cookie: `payload-tenant=${opts.cookie}` } : {}),
		user: opts.user ?? { id: 'u1' },
		payload: {
			collections: {
				tenants: { customIDType: opts.idType },
			},
			db: { defaultIDType: opts.idType ?? 'text' },
		},
	}) as unknown as PayloadRequest

describe('multiTenantScope.resolveRequest', () => {
	it('returns the payload-tenant cookie as a string', async () => {
		const { resolveRequest } = multiTenantScope()
		expect(await resolveRequest({ req: req({ cookie: 'tenant-a' }) })).toBe('tenant-a')
	})

	it('coerces a numeric cookie when the tenants collection uses number ids', async () => {
		const { resolveRequest } = multiTenantScope()
		expect(await resolveRequest({ req: req({ cookie: '42', idType: 'number' }) })).toBe('42')
	})

	it('falls back to a single assigned tenant when the cookie is missing', async () => {
		const { resolveRequest } = multiTenantScope()
		const selection = await resolveRequest({
			req: req({
				user: { id: 'u1', tenants: [{ tenant: 't1' }] },
			}),
		})
		expect(selection).toBe('t1')
	})

	it('returns every assigned tenant id when the cookie is missing and the user has several', async () => {
		const { resolveRequest } = multiTenantScope()
		const selection = await resolveRequest({
			req: req({
				user: {
					id: 'u1',
					tenants: [{ tenant: 't1' }, { tenant: { id: 't2' } }],
				},
			}),
		})
		expect(selection).toEqual(['t1', 't2'])
	})

	it('returns the wildcard when userHasAccessToAllTenants is true and no cookie is set', async () => {
		const { resolveRequest } = multiTenantScope({
			userHasAccessToAllTenants: (user) => (user as { role?: string }).role === 'admin',
		})
		expect(
			await resolveRequest({
				req: req({ user: { id: 'root', role: 'admin' } }),
			})
		).toBe(SCOPE_WILDCARD)
	})

	it('prefers the cookie over assigned tenants and the wildcard', async () => {
		const { resolveRequest } = multiTenantScope({
			userHasAccessToAllTenants: () => true,
		})
		expect(
			await resolveRequest({
				req: req({
					cookie: 'picked',
					user: { id: 'root', tenants: [{ tenant: 't1' }] },
				}),
			})
		).toBe('picked')
	})

	it('returns null when there is no cookie, no assigned tenants, and no wildcard', async () => {
		const { resolveRequest } = multiTenantScope()
		expect(await resolveRequest({ req: req({}) })).toBeNull()
	})
})

describe('multiTenantScope.resolveDoc', () => {
	it('reads the tenant field as a string id', async () => {
		const { resolveDoc } = multiTenantScope()
		expect(await resolveDoc({ doc: { id: 'p1', tenant: 't1' } })).toBe('t1')
	})

	it('unwraps a populated tenant relationship', async () => {
		const { resolveDoc } = multiTenantScope()
		expect(await resolveDoc({ doc: { id: 'p1', tenant: { id: 't1', name: 'A' } } })).toBe('t1')
	})

	it('uses a custom tenantField name', async () => {
		const { resolveDoc } = multiTenantScope({ tenantField: 'org' })
		expect(await resolveDoc({ doc: { id: 'p1', org: 7 } })).toBe('7')
	})

	it('returns null when the field is missing', async () => {
		const { resolveDoc } = multiTenantScope()
		expect(await resolveDoc({ doc: { id: 'p1' } })).toBeNull()
	})
})
