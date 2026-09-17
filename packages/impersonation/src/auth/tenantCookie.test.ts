import type { SanitizedCollectionConfig } from 'payload'
import { describe, expect, it } from 'vitest'

import type { ResolvedOptions } from '../types'
import {
	clearOnSwitchWithoutTenant,
	exitTenantCookies,
	readTenantCookie,
	startTenantCookies,
	tenantCookieName,
	uniqueAssignedTenantId,
} from './tenantCookie'

const authConfig = () =>
	({
		cookies: { sameSite: 'Lax', secure: false },
		tokenExpiration: 7200,
	}) as unknown as SanitizedCollectionConfig['auth']

const options = (clearOnSwitch = ['payload-tenant']): ResolvedOptions =>
	({ cookies: { clearOnSwitch } }) as ResolvedOptions

describe('tenantCookie', () => {
	it('names the selector after cookiePrefix', () => {
		expect(tenantCookieName('payload')).toBe('payload-tenant')
		expect(tenantCookieName('acme')).toBe('acme-tenant')
	})

	it('strips the tenant cookie from clearOnSwitch', () => {
		expect(clearOnSwitchWithoutTenant(['payload-tenant', 'other'], 'payload')).toEqual(['other'])
	})

	it('reads a well-formed selector and drops junk', () => {
		expect(readTenantCookie(new Headers({ cookie: 'payload-tenant=tenant-a' }), 'payload')).toBe(
			'tenant-a'
		)
		expect(
			readTenantCookie(new Headers({ cookie: 'payload-tenant=a,b' }), 'payload')
		).toBeUndefined()
		expect(readTenantCookie(new Headers({ cookie: 'payload-tenant=' }), 'payload')).toBeUndefined()
	})

	it('treats a unique tenants or tenant assignment as the selector', () => {
		expect(uniqueAssignedTenantId({ tenants: ['alpha'] })).toBe('alpha')
		expect(uniqueAssignedTenantId({ tenant: { relationTo: 'tenants', value: 'alpha' } })).toBe(
			'alpha'
		)
		expect(uniqueAssignedTenantId({ tenants: [{ id: 12 }] })).toBe('12')
		expect(uniqueAssignedTenantId({ tenants: ['alpha', 'beta'] })).toBeUndefined()
		expect(uniqueAssignedTenantId({})).toBeUndefined()
	})

	it('sets the unique assigned tenant on swap start and expires when there is none', () => {
		const set = startTenantCookies({
			authConfig: authConfig(),
			cookiePrefix: 'payload',
			mode: 'swap',
			options: options(),
			target: { tenants: ['alpha'] },
		})
		expect(set[0]).toContain('payload-tenant=alpha')
		expect(set[0]).not.toContain('HttpOnly=true')

		const expired = startTenantCookies({
			authConfig: authConfig(),
			cookiePrefix: 'payload',
			mode: 'swap',
			options: options(),
			target: {},
		})
		expect(expired[0]).toContain('payload-tenant=')
		expect(new Date(expired[0]?.match(/Expires=([^;]+)/)?.[1] ?? '').getTime()).toBeLessThan(
			Date.now()
		)
	})

	it('leaves the tenant cookie alone in parallel', () => {
		expect(
			startTenantCookies({
				authConfig: authConfig(),
				cookiePrefix: 'payload',
				mode: 'parallel',
				options: options(),
				target: { tenants: ['alpha'] },
			})
		).toEqual([])
		expect(
			exitTenantCookies({
				authConfig: authConfig(),
				cookiePrefix: 'payload',
				mode: 'parallel',
				options: options(),
				snapshot: 'alpha',
			})
		).toEqual([])
	})

	it('restores the snapshot on swap exit', () => {
		const restored = exitTenantCookies({
			authConfig: authConfig(),
			cookiePrefix: 'payload',
			mode: 'swap',
			options: options(),
			snapshot: 'tenant-a',
		})
		expect(restored[0]).toContain('payload-tenant=tenant-a')
	})

	it('does nothing when clearOnSwitch does not manage the tenant cookie', () => {
		expect(
			startTenantCookies({
				authConfig: authConfig(),
				cookiePrefix: 'payload',
				mode: 'swap',
				options: options([]),
				target: { tenants: ['alpha'] },
			})
		).toEqual([])
	})
})
