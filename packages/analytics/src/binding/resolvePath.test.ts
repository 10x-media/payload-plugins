import type { PayloadRequest } from 'payload'
import { describe, expect, it } from 'vitest'
import { resolveHostname, resolvePath } from './resolvePath'
import type { AnalyticsBinding, BindingContext } from './types'

const ctx: BindingContext = { req: {} as PayloadRequest, locale: undefined }

describe('resolvePath', () => {
	it('uses the path resolver when it returns a value', () => {
		const binding: AnalyticsBinding = { path: (doc) => `/${doc.slug as string}` }
		expect(resolvePath(binding, { slug: 'pricing' }, ctx)).toBe('/pricing')
	})

	it('falls back to pathField when the resolver returns null', () => {
		const binding: AnalyticsBinding = { path: () => null, pathField: 'permalink' }
		expect(resolvePath(binding, { permalink: '/about' }, ctx)).toBe('/about')
	})

	it('falls back to pathField when no resolver is given', () => {
		const binding: AnalyticsBinding = { pathField: 'url' }
		expect(resolvePath(binding, { url: '/blog/hello' }, ctx)).toBe('/blog/hello')
	})

	it('reads a nested pathField via dot path', () => {
		const binding: AnalyticsBinding = { pathField: 'meta.path' }
		expect(resolvePath(binding, { meta: { path: '/nested' } }, ctx)).toBe('/nested')
	})

	it('returns null when neither resolver nor field yields a non-empty string', () => {
		expect(resolvePath({ path: () => null, pathField: 'slug' }, {}, ctx)).toBeNull()
		expect(resolvePath({ pathField: 'slug' }, { slug: '' }, ctx)).toBeNull()
		expect(resolvePath({ pathField: 'slug' }, { slug: 42 }, ctx)).toBeNull()
	})
})

describe('resolveHostname', () => {
	it('returns a static hostname string', () => {
		expect(resolveHostname({ hostname: 'example.com' }, {})).toBe('example.com')
	})

	it('calls a hostname resolver with the doc', () => {
		expect(
			resolveHostname({ hostname: (doc) => `${doc.tenant as string}.app` }, { tenant: 'acme' })
		).toBe('acme.app')
	})

	it('returns undefined when no hostname is configured', () => {
		expect(resolveHostname({}, { slug: 'x' })).toBeUndefined()
	})
})
