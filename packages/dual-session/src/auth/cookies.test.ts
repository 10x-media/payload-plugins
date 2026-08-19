import type { CollectionSlug, SanitizedCollectionConfig, TypedUser } from 'payload'
import { describe, expect, it } from 'vitest'

import {
	generateExpiredIsolatedCookie,
	generateIsolatedCookie,
	getIsolatedCookieName,
	getSharedCookieName,
	resolveSlotCookieName,
} from './cookies'

const CUSTOMER_COOKIE = 'payload-customers-token'
const SHARED_COOKIE = 'payload-token'
const STAFF_COOKIE = 'payload-users-frontend-token'

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

	it('normalises a boolean sameSite the way Payload does', () => {
		const strict = generateIsolatedCookie({
			authConfig: authConfig({ cookies: { sameSite: true, secure: false } }),
			name: CUSTOMER_COOKIE,
			token: 'a.b.c',
		})
		const omitted = generateIsolatedCookie({
			authConfig: authConfig({ cookies: { sameSite: false, secure: false } }),
			name: CUSTOMER_COOKIE,
			token: 'a.b.c',
		})

		expect(strict).toContain('SameSite=Strict')
		expect(omitted).not.toContain('SameSite')
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

describe('resolveSlotCookieName', () => {
	const admin = { id: 1, roles: ['admin'] } as unknown as TypedUser
	const writer = { id: 2, roles: ['writer'] } as unknown as TypedUser

	const roleSplit = {
		cookieName: STAFF_COOKIE,
		isolate: (user: TypedUser) => !(user as { roles?: string[] }).roles?.includes('admin'),
	}

	it('sends every user of a fully isolated collection to its own cookie', () => {
		expect(
			resolveSlotCookieName({
				entry: { cookieName: CUSTOMER_COOKIE },
				sharedName: SHARED_COOKIE,
				user: admin,
			})
		).toBe(CUSTOMER_COOKIE)
	})

	it('leaves a user the predicate rejects on the shared cookie', () => {
		// Which is what keeps the admin panel byte-identical to core on a role-split
		// collection: the admin's session never moves.
		expect(
			resolveSlotCookieName({ entry: roleSplit, sharedName: SHARED_COOKIE, user: admin })
		).toBe(SHARED_COOKIE)
	})

	it('moves a user the predicate claims onto the isolated cookie', () => {
		expect(
			resolveSlotCookieName({ entry: roleSplit, sharedName: SHARED_COOKIE, user: writer })
		).toBe(STAFF_COOKIE)
	})

	it('answers nothing when there is no user to ask about', () => {
		expect(
			resolveSlotCookieName({ entry: roleSplit, sharedName: SHARED_COOKIE, user: null })
		).toBeUndefined()
	})
})

describe('getSharedCookieName', () => {
	it('names the config-wide cookie core writes', () => {
		expect(getSharedCookieName('payload')).toBe(SHARED_COOKIE)
		expect(getSharedCookieName('acme')).toBe('acme-token')
	})
})
