import type { CollectionSlug, TypedUser } from 'payload'
import { describe, expect, it } from 'vitest'

import { resolveCollections } from './resolveCollections'

const slug = (value: string) => value as CollectionSlug

const resolve = (collections: Parameters<typeof resolveCollections>[0]['collections']) =>
	resolveCollections({ collections, cookiePrefix: 'payload' })

describe('resolveCollections', () => {
	it('expands a bare slug to a full entry', () => {
		expect(resolve([slug('customers')])).toEqual([
			{ slug: 'customers', cookieName: 'payload-customers-token', scopes: ['frontend'] },
		])
	})

	it('preserves order, because order is priority', () => {
		expect(resolve([slug('partners'), slug('customers')]).map(({ slug: entry }) => entry)).toEqual([
			'partners',
			'customers',
		])
	})

	it('leaves `isolate` absent when the whole collection is isolated', () => {
		// Absence is the signal, not a predicate that happens to always return true: callers
		// that cannot see a user answer differently for the two.
		expect(resolve([slug('customers')])[0]).not.toHaveProperty('isolate')
	})

	it('carries a custom predicate through untouched', () => {
		const isolate = (user: TypedUser) => user.id === 1

		expect(resolve([{ slug: slug('users'), isolate }])[0]?.isolate).toBe(isolate)
	})
})
