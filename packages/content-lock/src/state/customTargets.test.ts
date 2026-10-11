import { describe, expect, it } from 'vitest'

import { type CustomTarget, customTargetsAt, pathMatches } from './customTargets'

describe('pathMatches', () => {
	it('matches a prefix on segment boundaries', () => {
		const rule = { match: 'prefix', path: '/reports' } as const
		expect(pathMatches(rule, '/reports')).toBe(true)
		expect(pathMatches(rule, '/reports/2026')).toBe(true)
		expect(pathMatches(rule, '/reportsx')).toBe(false)
		expect(pathMatches(rule, '/')).toBe(false)
	})

	it('matches exactly, ignoring the query and a trailing slash', () => {
		const rule = { match: 'exact', path: 'reports/edit' } as const
		expect(pathMatches(rule, '/reports/edit?year=2026')).toBe(true)
		expect(pathMatches(rule, '/reports/edit/')).toBe(true)
		expect(pathMatches(rule, '/reports/edit/1')).toBe(false)
	})
})

describe('customTargetsAt', () => {
	const targets: CustomTarget[] = [
		{ key: 'reports', label: 'Reports', paths: [{ match: 'prefix', path: '/reports' }] },
		{ key: 'crm', label: 'CRM', paths: [{ match: 'exact', path: '/settings/crm' }] },
		{ key: 'sync', label: 'Sync', paths: [] },
	]

	it('lists the targets an admin page stands for', () => {
		expect(customTargetsAt(targets, '/reports/2026')).toEqual(['reports'])
		expect(customTargetsAt(targets, '/settings/crm')).toEqual(['crm'])
		expect(customTargetsAt(targets, '/collections/posts')).toEqual([])
	})
})
