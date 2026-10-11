import { describe, expect, it } from 'vitest'

import type { ResolvedOptions } from '../types'
import { isStartableAuthCollection } from './startable'

const options = {
	collectionSlug: 'impersonation-sessions',
	session: {},
	targets: undefined,
} as Pick<ResolvedOptions, 'collectionSlug' | 'session' | 'targets'>

describe('isStartableAuthCollection', () => {
	it('drops disableLocalStrategy when no session seams are set', () => {
		expect(
			isStartableAuthCollection(
				{ auth: { disableLocalStrategy: true }, slug: 'sso-users' },
				options
			)
		).toBe(false)
	})

	it('drops useSessions: false when no session seams are set', () => {
		expect(isStartableAuthCollection({ auth: { useSessions: false }, slug: 'keys' }, options)).toBe(
			false
		)
	})

	it('keeps local-strategy auth collections', () => {
		expect(isStartableAuthCollection({ auth: true, slug: 'users' }, options)).toBe(true)
	})

	it('keeps an explicit target even when local strategy is off', () => {
		expect(
			isStartableAuthCollection(
				{ auth: { disableLocalStrategy: true }, slug: 'sso-users' },
				{ ...options, targets: ['sso-users'] }
			)
		).toBe(true)
	})

	it('drops the records collection', () => {
		expect(isStartableAuthCollection({ auth: true, slug: 'impersonation-sessions' }, options)).toBe(
			false
		)
	})

	it('keeps disableLocalStrategy when all session seams are set', () => {
		expect(
			isStartableAuthCollection(
				{ auth: { disableLocalStrategy: true }, slug: 'sso-users' },
				{
					...options,
					session: {
						binding: () => 'sid',
						issue: async () => ({}) as never,
						revoke: async () => undefined,
					},
				}
			)
		).toBe(true)
	})
})
