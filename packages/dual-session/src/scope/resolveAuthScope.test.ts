import { describe, expect, it } from 'vitest'

import { resolveAuthScope } from './resolveAuthScope'

describe('resolveAuthScope', () => {
	it('treats the admin panel and its server actions as admin scope', () => {
		expect(resolveAuthScope({ pathname: '/admin' })).toBe('admin')
		expect(resolveAuthScope({ pathname: '/admin/collections/pages' })).toBe('admin')
	})

	it('does not confuse a lookalike prefix with the admin route', () => {
		expect(resolveAuthScope({ pathname: '/administration' })).toBe('frontend')
	})

	it('attributes REST calls by their referer', () => {
		const origin = 'https://site.test'

		expect(
			resolveAuthScope({
				origin,
				pathname: '/api/pages',
				referer: 'https://site.test/admin/collections/pages',
			})
		).toBe('admin')
		expect(
			resolveAuthScope({ origin, pathname: '/api/pages', referer: 'https://site.test/members' })
		).toBe('frontend')
	})

	it('treats everything else as frontend scope', () => {
		expect(resolveAuthScope({ pathname: '/' })).toBe('frontend')
		expect(resolveAuthScope({ pathname: '/members/profile' })).toBe('frontend')
	})

	it('honours custom route prefixes', () => {
		expect(resolveAuthScope({ adminRoute: '/backoffice', pathname: '/backoffice/x' })).toBe('admin')
		expect(resolveAuthScope({ adminRoute: '/backoffice', pathname: '/admin' })).toBe('frontend')
	})

	describe('unattributable REST calls', () => {
		it('resolves to no scope rather than guessing', () => {
			expect(resolveAuthScope({ pathname: '/api/pages' })).toBeUndefined()
			expect(resolveAuthScope({ pathname: '/api/pages', referer: 'not-a-url' })).toBeUndefined()
		})

		it('leaves pages attributable, since only the api route is shared', () => {
			expect(resolveAuthScope({ pathname: '/products' })).toBe('frontend')
			expect(resolveAuthScope({ pathname: '/admin/x' })).toBe('admin')
		})
	})

	describe('a referer from another origin', () => {
		it('is frontend even when its path looks like the admin route', () => {
			expect(
				resolveAuthScope({
					pathname: '/api/orders',
					referer: 'https://shop.test/admin/orders',
					secFetchSite: 'cross-site',
				})
			).toBe('frontend')
		})

		it('is frontend across subdomains too', () => {
			expect(
				resolveAuthScope({
					pathname: '/api/orders',
					referer: 'https://app.site.test/admin/orders',
					secFetchSite: 'same-site',
				})
			).toBe('frontend')
		})

		it('still reads the path when the request is same-origin', () => {
			expect(
				resolveAuthScope({
					pathname: '/api/orders',
					referer: 'https://site.test/admin/orders',
					secFetchSite: 'same-origin',
				})
			).toBe('admin')
		})

		describe('with no Sec-Fetch-Site to go on', () => {
			it('vets the referer against the origin instead', () => {
				expect(
					resolveAuthScope({
						origin: 'https://site.test',
						pathname: '/api/orders',
						referer: 'https://site.test/admin/orders',
						secFetchSite: null,
					})
				).toBe('admin')
			})

			it('is frontend for another origin whose path looks like the admin route', () => {
				// The whole attack: a page anywhere can set its own path to `/admin` and, on a
				// client that sends no `Sec-Fetch-Site`, claim the admin scope with it.
				expect(
					resolveAuthScope({
						origin: 'https://site.test',
						pathname: '/api/orders',
						referer: 'https://evil.test/admin/orders',
						secFetchSite: null,
					})
				).toBe('frontend')
			})

			it('is frontend for a sibling subdomain, which is a different origin', () => {
				expect(
					resolveAuthScope({
						origin: 'https://site.test',
						pathname: '/api/orders',
						referer: 'https://app.site.test/admin/orders',
					})
				).toBe('frontend')
			})

			it('will not call it admin when the caller passes no origin either', () => {
				// Nothing left to verify the referer with, so the path is not evidence.
				expect(
					resolveAuthScope({
						pathname: '/api/orders',
						referer: 'https://site.test/admin/orders',
					})
				).toBe('frontend')
			})
		})
	})
})
