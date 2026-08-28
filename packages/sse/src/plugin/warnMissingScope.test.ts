import type { CollectionConfig, Payload } from 'payload'
import { describe, expect, it, vi } from 'vitest'

import { collectionHasTenantRelationship, warnMissingScope } from './warnMissingScope'

describe('collectionHasTenantRelationship', () => {
	it('detects a top-level relationship to tenants', () => {
		const collection = {
			slug: 'posts',
			fields: [{ name: 'tenant', type: 'relationship', relationTo: 'tenants' }],
		} as CollectionConfig
		expect(collectionHasTenantRelationship(collection)).toBe(true)
	})

	it('detects a relationship to a custom tenants slug', () => {
		const collection = {
			slug: 'posts',
			fields: [{ name: 'org', type: 'relationship', relationTo: 'orgs' }],
		} as CollectionConfig
		expect(collectionHasTenantRelationship(collection, 'orgs')).toBe(true)
		expect(collectionHasTenantRelationship(collection)).toBe(false)
	})

	it('returns false when there is no tenant relationship', () => {
		const collection = {
			slug: 'posts',
			fields: [{ name: 'title', type: 'text' }],
		} as CollectionConfig
		expect(collectionHasTenantRelationship(collection)).toBe(false)
	})
})

describe('warnMissingScope', () => {
	it('warns when an opted-in collection has a tenant field and scope is off', () => {
		const warn = vi.fn()
		const payload = {
			logger: { warn },
			collections: {
				posts: {
					config: {
						slug: 'posts',
						fields: [{ name: 'tenant', type: 'relationship', relationTo: 'tenants' }],
					},
				},
			},
		} as unknown as Payload

		warnMissingScope({ payload, sourceSlugs: ['posts'], scopeEnabled: false })
		expect(warn).toHaveBeenCalledOnce()
		expect(warn.mock.calls[0]?.[0]).toMatch(/scope/)
	})

	it('does not warn when scope is enabled', () => {
		const warn = vi.fn()
		const payload = {
			logger: { warn },
			collections: {
				posts: {
					config: {
						slug: 'posts',
						fields: [{ name: 'tenant', type: 'relationship', relationTo: 'tenants' }],
					},
				},
			},
		} as unknown as Payload

		warnMissingScope({ payload, sourceSlugs: ['posts'], scopeEnabled: true })
		expect(warn).not.toHaveBeenCalled()
	})

	it('warns using the configured tenantsSlug', () => {
		const warn = vi.fn()
		const payload = {
			logger: { warn },
			collections: {
				posts: {
					config: {
						slug: 'posts',
						fields: [{ name: 'org', type: 'relationship', relationTo: 'orgs' }],
					},
				},
			},
		} as unknown as Payload

		warnMissingScope({
			payload,
			sourceSlugs: ['posts'],
			scopeEnabled: false,
			tenantsSlug: 'orgs',
		})
		expect(warn).toHaveBeenCalledOnce()

		warn.mockClear()
		warnMissingScope({ payload, sourceSlugs: ['posts'], scopeEnabled: false })
		expect(warn).not.toHaveBeenCalled()
	})
})
