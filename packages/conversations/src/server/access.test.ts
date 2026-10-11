import { describe, expect, it } from 'vitest'

import { resolveGrant, resolveGrants } from './access'

const offered = ['internal', 'shared']
const plain = (grant: ReturnType<typeof resolveGrant>) => ({
	create: [...grant.create],
	read: [...grant.read],
})

describe('resolveGrant', () => {
	it('reads true and lists as read and write, within the offered channels', () => {
		expect(plain(resolveGrant(true, offered))).toEqual({ create: offered, read: offered })
		expect(plain(resolveGrant(['shared', 'nope'], offered))).toEqual({
			create: ['shared'],
			read: ['shared'],
		})
	})

	it('splits read and create, with create defaulting to read and never beyond it', () => {
		expect(plain(resolveGrant({ create: [], read: true }, offered))).toEqual({
			create: [],
			read: offered,
		})
		expect(plain(resolveGrant({ read: ['shared'] }, offered))).toEqual({
			create: ['shared'],
			read: ['shared'],
		})
		expect(plain(resolveGrant({ create: true, read: ['shared'] }, offered))).toEqual({
			create: ['shared'],
			read: ['shared'],
		})
	})
})

describe('resolveGrants', () => {
	const map = new Map([
		['a', offered],
		['b', offered],
	])

	it('takes a key list as full grants and drops keys not asked about', () => {
		const grants = resolveGrants(['a', 'x'], map)
		expect([...grants.keys()]).toEqual(['a'])
	})

	it('takes a record, dropping denied keys and grants with nothing to read', () => {
		const grants = resolveGrants({ a: { create: [], read: ['shared'] }, b: [], x: true }, map)
		expect([...grants.keys()]).toEqual(['a'])
		expect(plain(grants.get('a') as ReturnType<typeof resolveGrant>)).toEqual({
			create: [],
			read: ['shared'],
		})
		expect(resolveGrants({ a: false, b: null }, map).size).toBe(0)
	})
})
