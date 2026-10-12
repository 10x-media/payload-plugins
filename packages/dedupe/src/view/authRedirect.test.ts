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
		const url = authRedirectUrl({ config, params: { segments: ['dedupe'] }, user: null })
		expect(url.startsWith('/admin/login?redirect=')).toBe(true)
	})

	it('sends a signed-in reader without permission to unauthorized', () => {
		const url = authRedirectUrl({ config, params: { segments: ['dedupe'] }, user: { id: 1 } })
		expect(url.startsWith('/admin/unauthorized?redirect=')).toBe(true)
	})

	it('comes back to the screen that was asked for, with its query', () => {
		const url = authRedirectUrl({
			config,
			params: { segments: ['dedupe', 'merge'] },
			searchParams: { collection: 'customers', docs: '1,2', survivor: '1' },
			user: null,
		})
		expect(decodeReturn(url)).toBe('/admin/dedupe/merge?collection=customers&docs=1%2C2&survivor=1')
	})

	it('drops an inherited redirect rather than nesting one round trip in another', () => {
		const url = authRedirectUrl({
			config,
			params: { segments: ['dedupe'] },
			searchParams: { redirect: '/admin/elsewhere', status: 'open' },
			user: null,
		})
		expect(decodeReturn(url)).toBe('/admin/dedupe?status=open')
	})
})
