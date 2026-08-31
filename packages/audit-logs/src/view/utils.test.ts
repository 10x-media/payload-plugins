import { describe, expect, it } from 'vitest'

import {
	apiBadgeClass,
	apiLabel,
	buildParams,
	displayUser,
	formatValue,
	isLongValue,
} from './utils'

describe('displayUser', () => {
	it('shows a dash when nobody is recorded', () => {
		expect(displayUser(null, {})).toBe('—')
		expect(displayUser(undefined, {})).toBe('—')
	})

	it('shows the raw id when the relationship was not populated', () => {
		expect(displayUser('abc123', { users: 'email' })).toBe('abc123')
		expect(displayUser(7, { users: 'email' })).toBe('7')
	})

	it('reads the title field of a populated polymorphic user', () => {
		const user = { relationTo: 'admins', value: { id: 1, email: 'a@b.c' } }
		expect(displayUser(user, { admins: 'email', users: 'name' })).toBe('a@b.c')
	})

	it('falls back to the id when the title field is missing', () => {
		const user = { relationTo: 'admins', value: { id: 1 } }
		expect(displayUser(user, { admins: 'email' })).toBe('1')
	})

	it('reads the title field of a populated single-collection user', () => {
		expect(displayUser({ id: 1, email: 'a@b.c' }, { users: 'email' })).toBe('a@b.c')
	})

	it('shows the id when several collections make the shape ambiguous', () => {
		expect(displayUser({ id: 1, email: 'a@b.c' }, { users: 'email', admins: 'name' })).toBe('1')
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
