import type { PayloadRequest } from 'payload'
import { describe, expect, expectTypeOf, it } from 'vitest'
import type { AnalyticsPluginOptions } from '../core/options'
import type {
	AnalyticsBinding,
	BindingContext,
	BindingDoc,
	HostnameResolver,
	PathResolver,
} from './types'

describe('binding resolver types', () => {
	it('gives resolvers a typed doc and context, never any', () => {
		expectTypeOf<Parameters<PathResolver>[0]>().not.toBeAny()
		expectTypeOf<Parameters<HostnameResolver>[0]>().not.toBeAny()
		expectTypeOf<BindingDoc[string]>().toEqualTypeOf<unknown>()
		expectTypeOf<Parameters<PathResolver>[1]>().toEqualTypeOf<BindingContext>()
		expectTypeOf<Parameters<HostnameResolver>[1]>().toEqualTypeOf<BindingContext>()
		expectTypeOf<BindingContext['req']>().toEqualTypeOf<PayloadRequest>()
	})

	it('accepts sync, async, and null-returning resolvers', () => {
		const binding = {
			path: (doc, ctx) => {
				expectTypeOf(doc).not.toBeAny()
				expectTypeOf(ctx.req).toEqualTypeOf<PayloadRequest>()
				return typeof doc.slug === 'string' ? `/${doc.slug}` : null
			},
			hostname: async (doc) => (typeof doc.domain === 'string' ? doc.domain : null),
		} satisfies AnalyticsBinding
		expect(binding.path).toBeTypeOf('function')
	})

	it('keeps sync one-argument hostname resolvers assignable', () => {
		const legacy: HostnameResolver = () => 'example.com'
		const binding: AnalyticsBinding = { pathField: 'permalink', hostname: legacy }
		expect(binding.hostname).toBe(legacy)
	})

	it('rejects wrong resolver shapes', () => {
		// @ts-expect-error hostname must be a string or resolver, not a number
		const bad: AnalyticsBinding = { hostname: 5 }
		// @ts-expect-error a path resolver must return string | null, not number
		const badPath: AnalyticsBinding = { path: () => 5 }
		expect(bad).toBeDefined()
		expect(badPath).toBeDefined()
	})

	it('types docs for inline per-collection bindings in plugin options', () => {
		const options = {
			collections: {
				pages: {
					path: (doc) => {
						expectTypeOf(doc).not.toBeAny()
						return typeof doc.slug === 'string' ? `/${doc.slug}` : null
					},
				},
			},
			sync: { collectionSlug: 'analytics-daily' },
		} satisfies AnalyticsPluginOptions
		expect(options.collections.pages.path).toBeTypeOf('function')
	})
})
