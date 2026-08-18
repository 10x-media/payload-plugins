import type { CollectionSlug, SanitizedCollectionConfig } from 'payload'
import { describe, expect, it } from 'vitest'

import {
	generateExpiredIsolatedCookie,
	generateIsolatedCookie,
	getIsolatedCookieName,
} from './cookies'

const CUSTOMER_COOKIE = 'payload-customers-token'

const slug = (value: string) => value as CollectionSlug

const authConfig = (overrides: Record<string, unknown> = {}) =>
	({
		cookies: { sameSite: 'Lax', secure: false },
		depth: 0,
		tokenExpiration: 7200,
		useSessions: true,
		verify: false,
		...overrides,
	}) as unknown as SanitizedCollectionConfig['auth']

describe('isolated cookies', () => {
	it('scopes the cookie name by collection slug', () => {
		expect(getIsolatedCookieName({ cookiePrefix: 'payload', slug: slug('customers') })).toBe(
			CUSTOMER_COOKIE
		)
		expect(getIsolatedCookieName({ cookiePrefix: 'acme', slug: slug('partners') })).toBe(
			'acme-partners-token'
		)
	})

	it('carries the same hardening as Payload’s own auth cookie', () => {
		const cookie = generateIsolatedCookie({
			authConfig: authConfig({ cookies: { sameSite: 'Lax', secure: true } }),
			name: CUSTOMER_COOKIE,
			token: 'a.b.c',
		})

		expect(cookie).toContain(`${CUSTOMER_COOKIE}=a.b.c`)
		expect(cookie).toContain('HttpOnly=true')
		expect(cookie).toContain('Path=/')
		expect(cookie).toContain('Secure=true')
		expect(cookie).toContain('SameSite=Lax')
	})

	it('expires in the past when logging out', () => {
		const cookie = generateExpiredIsolatedCookie({
			authConfig: authConfig(),
			name: CUSTOMER_COOKIE,
		})

		const expires = cookie.match(/Expires=([^;]+)/)?.[1]

		expect(cookie).toContain(`${CUSTOMER_COOKIE}=;`)
		expect(new Date(expires ?? '').getTime()).toBeLessThan(Date.now())
	})
})
