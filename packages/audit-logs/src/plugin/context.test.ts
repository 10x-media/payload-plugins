import type { CollectionConfig, Config } from 'payload'
import { describe, expect, it } from 'vitest'

import { buildPluginContext } from './context'

const auth = (slug: string): CollectionConfig =>
	({ slug, auth: true, fields: [] }) as unknown as CollectionConfig
const plain = (slug: string): CollectionConfig =>
	({ slug, fields: [] }) as unknown as CollectionConfig

const config = (collections: CollectionConfig[]): Config => ({ collections }) as Config

describe('buildPluginContext', () => {
	describe('what the user field points at', () => {
		it('one auth collection stores a plain id', () => {
			const ctx = buildPluginContext(config([auth('users'), plain('posts')]), {})
			expect(ctx.defaultRelationTo).toBe('users')
			expect(ctx.isUserPolymorphic).toBe(false)
		})

		it('several auth collections make it polymorphic', () => {
			const ctx = buildPluginContext(config([auth('users'), auth('admins')]), {})
			expect(ctx.defaultRelationTo).toEqual(['users', 'admins'])
			expect(ctx.isUserPolymorphic).toBe(true)
		})

		it('no auth collection falls back to the conventional slug', () => {
			const ctx = buildPluginContext(config([plain('posts')]), {})
			expect(ctx.defaultRelationTo).toBe('users')
			expect(ctx.isUserPolymorphic).toBe(false)
		})
	})

	describe('grouping', () => {
		it('is off unless asked for', () => {
			const ctx = buildPluginContext(config([]), {})
			expect(ctx.groupEnabled).toBe(false)
			expect(ctx.groupContextKey).toBeUndefined()
		})

		it('true uses the conventional context key', () => {
			const ctx = buildPluginContext(config([]), { logs: { group: true } })
			expect(ctx.groupContextKey).toBe('auditGroup')
		})

		it('a custom key wins', () => {
			const ctx = buildPluginContext(config([]), {
				logs: { group: { contextKey: 'requestId' } },
			})
			expect(ctx.groupContextKey).toBe('requestId')
		})
	})

	describe('multi-tenancy', () => {
		it('is absent by default', () => {
			const ctx = buildPluginContext(config([]), {})
			expect(ctx.multiTenancy).toBeUndefined()
			expect(ctx.tenantFieldName).toBeUndefined()
			expect(ctx.tenantsSlug).toBeUndefined()
		})

		it('true takes the conventional names', () => {
			const ctx = buildPluginContext(config([]), { multiTenancy: true })
			expect(ctx.tenantFieldName).toBe('tenant')
			expect(ctx.tenantsSlug).toBe('tenants')
		})

		it('an object overrides them', () => {
			const ctx = buildPluginContext(config([]), {
				multiTenancy: { tenantFieldName: 'org', tenantsSlug: 'orgs' },
			})
			expect(ctx.tenantFieldName).toBe('org')
			expect(ctx.tenantsSlug).toBe('orgs')
		})
	})

	describe('request metadata', () => {
		it('is collected unless switched off', () => {
			expect(buildPluginContext(config([]), {}).collectIpAddress).toBe(true)
			expect(buildPluginContext(config([]), {}).collectUserAgent).toBe(true)
		})

		it('honours an explicit false', () => {
			const ctx = buildPluginContext(config([]), {
				logs: { ipAddress: false, userAgent: false },
			})
			expect(ctx.collectIpAddress).toBe(false)
			expect(ctx.collectUserAgent).toBe(false)
		})
	})

	it('assumes the direct write until the log collection is built', () => {
		expect(buildPluginContext(config([]), {}).fastWrite).toBe(true)
	})
})
