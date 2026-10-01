import type { SanitizedCollectionConfig } from 'payload'
import { describe, expect, it } from 'vitest'

import type { ResolvedOptions } from '../types'
import {
	clearCookiesOnStart,
	clearOnSwitchWithoutTenant,
	exitTenantCookies,
	readTenantCookie,
	tenantCookieName,
} from './tenantCookie'

const authConfig = () =>
	({
		cookies: { sameSite: 'Lax', secure: false },
		tokenExpiration: 7200,
	}) as unknown as SanitizedCollectionConfig['auth']

const options = (clearOnSwitch = ['payload-tenant', 'side']): ResolvedOptions =>
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

	it('expires clearOnSwitch on swap start and leaves it alone in parallel', () => {
		const expired = clearCookiesOnStart({
			authConfig: authConfig(),
			cookiePrefix: 'payload',
			except: ['payload-token'],
			mode: 'swap',
			options: options(),
		})
		const tenant = expired.find((cookie) => cookie.startsWith('payload-tenant='))
		expect(tenant).toBeDefined()
		expect(tenant).not.toContain('HttpOnly=true')
		expect(new Date(tenant?.match(/Expires=([^;]+)/)?.[1] ?? '').getTime()).toBeLessThan(Date.now())
		expect(expired.some((cookie) => cookie.startsWith('side='))).toBe(true)
		expect(expired.some((cookie) => cookie.startsWith('payload-token='))).toBe(false)

		expect(
			clearCookiesOnStart({
				authConfig: authConfig(),
				cookiePrefix: 'payload',
				except: [],
				mode: 'parallel',
				options: options(),
			})
		).toEqual([])
	})

	it('leaves the tenant cookie alone in parallel on exit', () => {
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
			exitTenantCookies({
				authConfig: authConfig(),
				cookiePrefix: 'payload',
				mode: 'swap',
				options: options(['side']),
				snapshot: 'tenant-a',
			})
		).toEqual([])
	})
})
