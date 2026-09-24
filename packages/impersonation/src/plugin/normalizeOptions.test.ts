import type { Config } from 'payload'
import { describe, expect, it } from 'vitest'

import type { EnabledOptions } from '../types'
import { normalizeOptions } from './normalizeOptions'

const config = (overrides: Partial<Config> = {}): Config =>
	({
		admin: { user: 'users' },
		collections: [{ auth: true, fields: [], slug: 'users' }],
		...overrides,
	}) as Config

const enabled = (overrides: Partial<EnabledOptions> = {}): EnabledOptions => ({
	access: { impersonate: () => true },
	...overrides,
})

describe('normalizeOptions', () => {
	it('throws when access.impersonate is missing', () => {
		expect(() => normalizeOptions({ access: {} } as EnabledOptions, config())).toThrow(
			/access.impersonate must be a function/
		)
	})

	it('fills defaults', () => {
		const resolved = normalizeOptions(enabled(), config())
		expect(resolved.collectionSlug).toBe('impersonation-sessions')
		expect(resolved.apiPath).toBe('/impersonation')
		expect(resolved.hintCookieName).toBe('impersonation-hint')
		expect(resolved.decorateRequests).toBe(true)
		expect(resolved.reason).toBe('off')
		expect(resolved.cookies.clearOnSwitch).toEqual(['payload-tenant'])
		expect(resolved.maxDuration).toBeUndefined()
		expect(resolved.access.recordsListed).toBe(false)
		expect(resolved.ui).toEqual({
			bar: true,
			card: undefined,
			cardEmail: true,
			documentAction: true,
			headerAction: true,
			recordAction: true,
		})
	})

	it('throws when the hint cookie name starts with cookiePrefix', () => {
		expect(() => normalizeOptions(enabled({ hintCookieName: 'payload-hint' }), config())).toThrow(
			/must not start with cookiePrefix/
		)
	})

	it('throws when apiPath collides with a collection slug', () => {
		expect(() => normalizeOptions(enabled({ apiPath: '/users' }), config())).toThrow(/collides/)
	})

	it('throws when apiPath uses a reserved graphql segment', () => {
		expect(() => normalizeOptions(enabled({ apiPath: '/graphql' }), config())).toThrow(/collides/)
	})

	it('throws when admin.user has useSessions: false', () => {
		expect(() =>
			normalizeOptions(
				enabled(),
				config({
					collections: [{ auth: { useSessions: false }, fields: [], slug: 'users' }],
				})
			)
		).toThrow(/useSessions: false/)
	})

	it('throws when admin.user has disableLocalStrategy', () => {
		expect(() =>
			normalizeOptions(
				enabled(),
				config({
					collections: [{ auth: { disableLocalStrategy: true }, fields: [], slug: 'users' }],
				})
			)
		).toThrow(/disableLocalStrategy/)
	})

	it('disables every UI surface when ui is false', () => {
		expect(normalizeOptions(enabled({ ui: false }), config()).ui.bar).toBe(false)
	})

	it('derives the tenant cookie from cookiePrefix', () => {
		expect(
			normalizeOptions(enabled(), config({ cookiePrefix: 'acme' })).cookies.clearOnSwitch
		).toEqual(['acme-tenant'])
	})
})
