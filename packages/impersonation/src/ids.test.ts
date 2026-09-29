import type { Payload } from 'payload'
import { describe, expect, it } from 'vitest'

import { labelUser, userTitle } from './ids'

const payload = (useAsTitle?: string) =>
	({ collections: { users: { config: { admin: { useAsTitle } } } } }) as unknown as Payload

describe('userTitle', () => {
	it('reads the useAsTitle field', () => {
		expect(userTitle(payload('name'), 'users', { email: 'a@b.c', name: ' Dev Editor ' })).toBe(
			'Dev Editor'
		)
	})

	it('falls back to the email when the title is empty or the id', () => {
		expect(userTitle(payload('name'), 'users', { email: 'a@b.c', name: '' })).toBe('a@b.c')
		expect(userTitle(payload('id'), 'users', { email: 'a@b.c', id: 1 })).toBe('a@b.c')
		expect(userTitle(payload(), 'users', { email: 'a@b.c' })).toBe('a@b.c')
	})

	it('returns undefined without a title or an email', () => {
		expect(userTitle(payload('name'), 'users', {})).toBeUndefined()
		expect(userTitle(payload('name'), 'missing', null)).toBeUndefined()
	})
})

describe('labelUser', () => {
	it('prefers the title or the email per mode and falls back to the other', () => {
		const both = { email: 'a@b.c', title: 'Dev Editor' }
		expect(labelUser('title', both)).toBe('Dev Editor')
		expect(labelUser('email', both)).toBe('a@b.c')
		expect(labelUser('email', { title: 'Dev Editor' })).toBe('Dev Editor')
		expect(labelUser('title', { email: 'a@b.c', title: null })).toBe('a@b.c')
		expect(labelUser('title', {})).toBeUndefined()
	})
})
