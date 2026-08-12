import type { SanitizedConfig } from 'payload'
import { describe, expect, it } from 'vitest'

import { authRedirectUrl } from './authRedirect'

const config = {
	routes: { admin: '/admin' },
	admin: { routes: { login: '/login', unauthorized: '/unauthorized' } },
} as unknown as SanitizedConfig

const decodeReturn = (url: string): string =>
	decodeURIComponent(url.slice(url.indexOf('redirect=') + 'redirect='.length))

describe('authRedirectUrl', () => {
	it('sends a signed-out reader to login', () => {
		const url = authRedirectUrl({
			config,
			params: { segments: ['audit-logs'] },
			searchParams: {},
			user: null,
		})
		expect(url.startsWith('/admin/login?redirect=')).toBe(true)
	})

	it('sends a signed-in reader without permission to unauthorized, not back to login', () => {
		const url = authRedirectUrl({
			config,
			params: { segments: ['audit-logs'] },
			searchParams: {},
			user: { id: 1 },
		})
		expect(url.startsWith('/admin/unauthorized?redirect=')).toBe(true)
	})

	it('comes back to the view that was asked for', () => {
		const url = authRedirectUrl({
			config,
			params: { segments: ['audit-logs'] },
			searchParams: {},
			user: null,
		})
		expect(decodeReturn(url)).toBe('/admin/audit-logs')
	})

	it('keeps the filters the reader had', () => {
		const url = authRedirectUrl({
			config,
			params: { segments: ['audit-logs'] },
			searchParams: { operation: 'delete', page: '2' },
			user: null,
		})
		expect(decodeReturn(url)).toBe('/admin/audit-logs?operation=delete&page=2')
	})

	it('keeps every value of a repeated filter', () => {
		const url = authRedirectUrl({
			config,
			params: { segments: ['audit-logs'] },
			searchParams: { collection: ['posts', 'pages'] },
			user: null,
		})
		expect(decodeReturn(url)).toBe('/admin/audit-logs?collection=posts&collection=pages')
	})

	it('drops an inherited redirect rather than nesting one round trip in another', () => {
		const url = authRedirectUrl({
			config,
			params: { segments: ['audit-logs'] },
			searchParams: { redirect: '/admin/elsewhere', page: '2' },
			user: null,
		})
		expect(decodeReturn(url)).toBe('/admin/audit-logs?page=2')
	})

	it('handles a nested view path', () => {
		const url = authRedirectUrl({
			config,
			params: { segments: ['audit-logs', 'tenant-1'] },
			searchParams: {},
			user: null,
		})
		expect(decodeReturn(url)).toBe('/admin/audit-logs/tenant-1')
	})

	it('respects a custom admin route', () => {
		const custom = {
			routes: { admin: '/cms' },
			admin: { routes: { login: '/login', unauthorized: '/unauthorized' } },
		} as unknown as SanitizedConfig
		const url = authRedirectUrl({
			config: custom,
			params: { segments: ['audit-logs'] },
			searchParams: {},
			user: null,
		})
		expect(url.startsWith('/cms/login?redirect=')).toBe(true)
		expect(decodeReturn(url)).toBe('/cms/audit-logs')
	})
})
