import { describe, expect, it } from 'vitest'

import { resolveAuthScope } from './scope'

describe('resolveAuthScope', () => {
	it('treats the admin panel and its server actions as admin scope', () => {
		expect(resolveAuthScope({ pathname: '/admin' })).toBe('admin')
		expect(resolveAuthScope({ pathname: '/admin/collections/pages' })).toBe('admin')
	})

	it('does not confuse a lookalike prefix with the admin route', () => {
		expect(resolveAuthScope({ pathname: '/administration' })).toBe('frontend')
	})

	it('attributes REST calls by their referer', () => {
		expect(
			resolveAuthScope({
				pathname: '/api/pages',
				referer: 'https://site.test/admin/collections/pages',
			})
		).toBe('admin')
		expect(resolveAuthScope({ pathname: '/api/pages', referer: 'https://site.test/members' })).toBe(
			'frontend'
		)
	})

	it('falls back to admin scope for unattributed REST calls', () => {
		expect(resolveAuthScope({ pathname: '/api/pages' })).toBe('admin')
		expect(resolveAuthScope({ pathname: '/api/pages', referer: 'not-a-url' })).toBe('admin')
	})

	it('treats everything else as frontend scope', () => {
		expect(resolveAuthScope({ pathname: '/' })).toBe('frontend')
		expect(resolveAuthScope({ pathname: '/members/profile' })).toBe('frontend')
	})

	it('honours custom route prefixes', () => {
		expect(resolveAuthScope({ adminRoute: '/backoffice', pathname: '/backoffice/x' })).toBe('admin')
		expect(resolveAuthScope({ adminRoute: '/backoffice', pathname: '/admin' })).toBe('frontend')
	})
})
