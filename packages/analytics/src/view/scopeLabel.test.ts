import { describe, expect, it } from 'vitest'
import { canToggleAggregate, isAllScopes, scopeLabel } from './scopeLabel'
import type { ViewScopes } from './viewProps'

const scopes = (over: Partial<ViewScopes> = {}): ViewScopes => ({
	canAggregate: true,
	current: 'alpha',
	own: 'alpha',
	...over,
})

describe('isAllScopes', () => {
	// A scoped install that resolves nothing reads every tenant for an aggregate reader, so
	// the caption has to call that what it is rather than leaving it blank.
	it('counts the wildcard and an unresolved scope as every tenant', () => {
		expect(isAllScopes('*')).toBe(true)
		expect(isAllScopes('')).toBe(true)
		expect(isAllScopes('alpha')).toBe(false)
	})
})

describe('scopeLabel', () => {
	it('names every tenant for a cross-scope read', () => {
		expect(scopeLabel(scopes({ current: '*' }), 'All tenants')).toBe('All tenants')
		expect(scopeLabel(scopes({ current: '', own: '' }), 'All tenants')).toBe('All tenants')
	})

	// The host's own listing names the tenant, so the caption reads as a company rather than
	// as a database id; without one the id is the honest answer.
	it('prefers the host label and falls back to the scope itself', () => {
		expect(scopeLabel(scopes({ ownLabel: 'Alpha GmbH' }), 'All')).toBe('Alpha GmbH')
		expect(scopeLabel(scopes(), 'All')).toBe('alpha')
	})
})

describe('canToggleAggregate', () => {
	it('offers the Site select only to a reader with a tenant of their own to leave', () => {
		expect(canToggleAggregate(scopes())).toBe(true)
		// Still drawn while aggregating, so the reader can pick their own site again.
		expect(canToggleAggregate(scopes({ current: '*' }))).toBe(true)
		expect(canToggleAggregate(scopes({ canAggregate: false }))).toBe(false)
		expect(canToggleAggregate(scopes({ own: '' }))).toBe(false)
	})
})
