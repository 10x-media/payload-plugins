import { describe, expect, it } from 'vitest'

import { collectionKey, customKey, globalKey, parseKey, parseUserKey, userKey } from './keys'

describe('conversation keys', () => {
	it('formats and parses a collection key', () => {
		const key = collectionKey('persons', 42)
		expect(key).toBe('collection:persons:42')
		expect(parseKey(key)).toEqual({ id: '42', key, kind: 'collection', slug: 'persons' })
	})

	it('keeps colons inside a collection id', () => {
		expect(parseKey('collection:persons:a:b')).toMatchObject({ id: 'a:b', slug: 'persons' })
	})

	it('parses a global key', () => {
		expect(parseKey(globalKey('settings'))).toEqual({
			key: 'global:settings',
			kind: 'global',
			slug: 'settings',
		})
	})

	it('parses custom keys by their prefix, colons allowed', () => {
		expect(parseKey(customKey('room:general:2024'))).toEqual({
			key: 'custom:room:general:2024',
			kind: 'custom',
			slug: 'room',
		})
		expect(parseKey('custom:lobby')).toMatchObject({ kind: 'custom', slug: 'lobby' })
	})

	it.each([
		'',
		'collection',
		'collection:',
		'collection:persons',
		'collection:persons:',
		'collection::1',
		'global:',
		'global:a:b',
		'custom:',
		'other:thing',
		':x',
		42,
		null,
	])('rejects %j', (value) => {
		expect(parseKey(value)).toBeNull()
	})

	it('round-trips user keys', () => {
		expect(parseUserKey(userKey('customers', 7))).toEqual({ collection: 'customers', id: '7' })
		expect(parseUserKey('nope')).toBeNull()
		expect(parseUserKey('users:')).toBeNull()
	})
})
