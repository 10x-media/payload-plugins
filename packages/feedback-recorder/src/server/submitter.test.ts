import type { TypedUser } from 'payload'
import { describe, expect, it } from 'vitest'

import { submitterFrom } from './submitter'

const user = (fields: Record<string, unknown>) =>
	({ collection: 'users', id: 'abc', ...fields }) as unknown as TypedUser

describe('submitterFrom', () => {
	it('prefixes the id with the auth collection', () => {
		expect(submitterFrom(user({})).id).toBe('users:abc')
	})

	it('prefers name, then first and last name', () => {
		expect(submitterFrom(user({ name: 'Ada L.', firstName: 'Ada' })).name).toBe('Ada L.')
		expect(submitterFrom(user({ firstName: 'Ada', lastName: 'Lovelace' })).name).toBe(
			'Ada Lovelace'
		)
		expect(submitterFrom(user({})).name).toBeNull()
	})

	it('joins roles and ignores non-strings', () => {
		expect(submitterFrom(user({ roles: ['admin', 3, 'editor'] })).role).toBe('admin, editor')
		expect(submitterFrom(user({ roles: [] })).role).toBeNull()
		expect(submitterFrom(user({ role: 'editor' })).role).toBe('editor')
	})

	it('keeps the email', () => {
		expect(submitterFrom(user({ email: ' a@b.de ' })).email).toBe('a@b.de')
	})
})
