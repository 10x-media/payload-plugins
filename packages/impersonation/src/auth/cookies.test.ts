import type { SanitizedCollectionConfig } from 'payload'
import { describe, expect, it } from 'vitest'

import { clearOnSwitchOnStart, expireCookie, generateHintCookie, sharedCookieName } from './cookies'

const authConfig = (overrides: Record<string, unknown> = {}) =>
	({
		cookies: { sameSite: 'Lax', secure: false },
		tokenExpiration: 7200,
		...overrides,
	}) as unknown as SanitizedCollectionConfig['auth']

describe('cookies', () => {
	it('names the shared cookie after cookiePrefix', () => {
		expect(sharedCookieName('payload')).toBe('payload-token')
		expect(sharedCookieName('acme')).toBe('acme-token')
	})

	it('writes an HttpOnly hint cookie that is not the auth cookie', () => {
		const cookie = generateHintCookie({
			authConfig: authConfig(),
			name: 'impersonation-hint',
			value: 'row-id',
		})
		expect(cookie).toContain('impersonation-hint=row-id')
		expect(cookie).toContain('HttpOnly=true')
		expect(cookie).not.toContain('payload-token')
	})

	it('expires a named cookie in the past', () => {
		const cookie = expireCookie({ authConfig: authConfig(), name: 'payload-tenant' })
		const expires = cookie.match(/Expires=([^;]+)/)?.[1]
		expect(cookie).toContain('payload-tenant=')
		expect(new Date(expires ?? '').getTime()).toBeLessThan(Date.now())
	})

	it('expires clearOnSwitch on swap start except the minted cookie', () => {
		const expired = clearOnSwitchOnStart({
			authConfig: authConfig(),
			cookiePrefix: 'payload',
			except: ['payload-token'],
			mode: 'swap',
			names: ['payload-tenant', 'side', 'payload-token'],
		})
		expect(expired.map((cookie) => cookie.split('=')[0])).toEqual(['payload-tenant', 'side'])
	})

	it('leaves clearOnSwitch alone on parallel start', () => {
		expect(
			clearOnSwitchOnStart({
				authConfig: authConfig(),
				cookiePrefix: 'payload',
				except: [],
				mode: 'parallel',
				names: ['payload-tenant', 'side'],
			})
		).toEqual([])
	})
})
