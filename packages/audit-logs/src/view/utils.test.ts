import { describe, expect, it } from 'vitest'

import {
	apiBadgeClass,
	apiLabel,
	buildParams,
	formatValue,
	isLongValue,
	resolveUser,
} from './utils'

describe('resolveUser', () => {
	const single = { users: 'email' }
	const several = { admins: 'email', users: 'name' }

	it('returns nothing when nobody is recorded', () => {
		expect(resolveUser(null, single)).toBeUndefined()
		expect(resolveUser(undefined, single)).toBeUndefined()
	})

	it('reads the title field of a populated single-collection user', () => {
		expect(resolveUser({ id: 1, email: 'a@b.c' }, single)).toEqual({
			deleted: false,
			id: '1',
			label: 'a@b.c',
			slug: 'users',
		})
	})

	it('reads the title field of a populated polymorphic user', () => {
		const user = { relationTo: 'admins', value: { id: 1, email: 'a@b.c' } }
		expect(resolveUser(user, several)).toEqual({
			deleted: false,
			id: '1',
			label: 'a@b.c',
			slug: 'admins',
		})
	})

	it('falls back to the id when the title field is empty', () => {
		expect(resolveUser({ relationTo: 'admins', value: { id: 1 } }, several)?.label).toBe('1')
	})

	it('marks an unpopulated id as a deleted user', () => {
		expect(resolveUser('abc123', single)).toEqual({
			deleted: true,
			id: 'abc123',
			label: 'abc123',
			slug: 'users',
		})
	})

	it('marks an unpopulated polymorphic value as deleted instead of printing the object', () => {
		expect(resolveUser({ relationTo: 'admins', value: 7 }, several)).toEqual({
			deleted: true,
			id: '7',
			label: '7',
			slug: 'admins',
		})
	})

	it('leaves the slug out when several collections make a bare value ambiguous', () => {
		expect(resolveUser({ id: 1, email: 'a@b.c' }, several)).toEqual({
			deleted: false,
			id: '1',
			label: '1',
			slug: undefined,
		})
	})
})

describe('formatValue', () => {
	it('shows a dash for nothing', () => {
		expect(formatValue(null)).toBe('—')
		expect(formatValue(undefined)).toBe('—')
	})

	it('leaves strings alone and stringifies primitives', () => {
		expect(formatValue('text')).toBe('text')
		expect(formatValue(7)).toBe('7')
		expect(formatValue(false)).toBe('false')
	})

	it('pretty-prints anything structured', () => {
		expect(formatValue({ a: 1 })).toBe('{\n  "a": 1\n}')
	})
})

describe('isLongValue', () => {
	it('is false for primitives regardless of length', () => {
		expect(isLongValue('x'.repeat(200))).toBe(false)
		expect(isLongValue(null)).toBe(false)
	})

	it('is true only once a structure is big enough to need its own block', () => {
		expect(isLongValue({ a: 1 })).toBe(false)
		expect(isLongValue({ note: 'x'.repeat(100) })).toBe(true)
	})
})

describe('buildParams', () => {
	it('is empty when nothing is filtered', () => {
		expect(buildParams({})).toBe('')
	})

	it('repeats a key per value for multi-selects', () => {
		expect(buildParams({ collections: ['posts', 'pages'] })).toBe(
			'collection=posts&collection=pages'
		)
		expect(buildParams({ operations: ['create', 'delete'] })).toBe(
			'operation=create&operation=delete'
		)
	})

	it('sets single-value filters once', () => {
		expect(buildParams({ documentId: '42', group: 'import-7' })).toBe(
			'documentId=42&group=import-7'
		)
	})

	it('leaves page one out of the URL', () => {
		expect(buildParams({}, 1)).toBe('')
		expect(buildParams({}, 2)).toBe('page=2')
	})

	it('carries the limit when one is set', () => {
		expect(buildParams({}, 1, 50)).toBe('limit=50')
	})

	it('encodes a date range', () => {
		expect(buildParams({ dateFrom: '2026-01-01', dateTo: '2026-02-01' })).toBe(
			'dateFrom=2026-01-01&dateTo=2026-02-01'
		)
	})
})

describe('apiBadgeClass', () => {
	it('lowercases the value core sets', () => {
		expect(apiBadgeClass('REST')).toBe('al-badge--api-rest')
		expect(apiBadgeClass('GraphQL')).toBe('al-badge--api-graphql')
		expect(apiBadgeClass('local')).toBe('al-badge--api-local')
	})

	it('names a value core never defines', () => {
		expect(apiBadgeClass('MCP')).toBe('al-badge--api-mcp')
	})

	// The field is free text, so nothing stops a plugin storing a value with a space or a
	// quote in it, and that must not escape into the class attribute.
	it('folds anything that would not survive in a class name', () => {
		expect(apiBadgeClass('MCP Server')).toBe('al-badge--api-mcp-server')
		expect(apiBadgeClass('a"b')).toBe('al-badge--api-a-b')
	})
})

describe('apiLabel', () => {
	it('uses the label the host declared', () => {
		expect(apiLabel('MCP', { MCP: 'MCP Server' })).toBe('MCP Server')
	})

	it('shows an undeclared value as it was stored', () => {
		expect(apiLabel('MCP', {})).toBe('MCP')
	})

	it('does not reach an inherited property', () => {
		expect(apiLabel('constructor', {})).toBe('constructor')
		expect(apiLabel('toString', {})).toBe('toString')
	})
})
