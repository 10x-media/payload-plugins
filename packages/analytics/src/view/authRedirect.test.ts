import type { SanitizedConfig } from 'payload'
import { describe, expect, it } from 'vitest'
import { loginRedirectUrl } from './authRedirect'

const config = {
	routes: { admin: '/admin' },
	admin: { routes: { login: '/login' } },
} as unknown as SanitizedConfig

const decodeReturn = (url: string): string =>
	decodeURIComponent(url.slice(url.indexOf('redirect=') + 'redirect='.length))

describe('loginRedirectUrl', () => {
	it('sends a signed-out reader to the login route', () => {
		const url = loginRedirectUrl({ config, params: { segments: ['analytics'] } })
		expect(url.startsWith('/admin/login?redirect=')).toBe(true)
	})

	it('comes back to the view that was asked for', () => {
		const url = loginRedirectUrl({ config, params: { segments: ['analytics'] } })
		expect(decodeReturn(url)).toBe('/admin/analytics')
	})

	it('keeps the dashboard state the reader had', () => {
		const url = loginRedirectUrl({
			config,
			params: { segments: ['analytics'] },
			searchParams: { range: 'last7days', metric: 'visitors' },
		})
		expect(decodeReturn(url)).toBe('/admin/analytics?range=last7days&metric=visitors')
	})

	it('keeps every value of a repeated parameter', () => {
		const url = loginRedirectUrl({
			config,
			params: { segments: ['analytics'] },
			searchParams: { filters: ['country:eq:DE', 'device:eq:mobile'] },
		})
		expect(decodeReturn(url)).toBe(
			'/admin/analytics?filters=country%3Aeq%3ADE&filters=device%3Aeq%3Amobile'
		)
	})

	it('drops an inherited redirect rather than nesting one round trip in another', () => {
		const url = loginRedirectUrl({
			config,
			params: { segments: ['analytics'] },
			searchParams: { redirect: '/admin/elsewhere', range: 'today' },
		})
		expect(decodeReturn(url)).toBe('/admin/analytics?range=today')
	})

	it('falls back to the admin root when the view carries no segments', () => {
		expect(decodeReturn(loginRedirectUrl({ config }))).toBe('/admin')
	})

	it('respects a custom admin route', () => {
		const custom = {
			routes: { admin: '/cms' },
			admin: { routes: { login: '/login' } },
		} as unknown as SanitizedConfig
		const url = loginRedirectUrl({ config: custom, params: { segments: ['analytics'] } })
		expect(url.startsWith('/cms/login?redirect=')).toBe(true)
		expect(decodeReturn(url)).toBe('/cms/analytics')
	})
})
