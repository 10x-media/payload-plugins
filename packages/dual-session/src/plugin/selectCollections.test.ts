import type { CollectionConfig, CollectionSlug, Config } from 'payload'
import { describe, expect, it } from 'vitest'

import { resolveAdminUserSlug, selectCollections } from './selectCollections'

const slug = (value: string) => value as CollectionSlug

const incoming: CollectionConfig[] = [
	{ slug: 'users', auth: true, fields: [] },
	{ slug: 'customers', auth: true, fields: [] },
	{ slug: 'pages', fields: [] },
	{ slug: 'kiosks', auth: true, endpoints: false, fields: [] },
]

const select = (collections: CollectionSlug[], adminUserSlug = 'users') =>
	selectCollections({
		adminUserSlug,
		collections,
		cookiePrefix: 'payload',
		incoming,
	})

describe('resolveAdminUserSlug', () => {
	const config = (overrides: Partial<Config>): Config => overrides as Config

	it('prefers an explicit admin.user', () => {
		expect(resolveAdminUserSlug(config({ admin: { user: 'staff' }, collections: incoming }))).toBe(
			'staff'
		)
	})

	it('falls back to the first collection declaring auth, as sanitizeConfig does', () => {
		expect(
			resolveAdminUserSlug(
				config({
					collections: [
						{ slug: 'pages', fields: [] },
						{ slug: 'staff', auth: true, fields: [] },
						{ slug: 'customers', auth: true, fields: [] },
					],
				})
			)
		).toBe('staff')
	})

	it('falls back to the collection core would append when nothing has auth', () => {
		expect(resolveAdminUserSlug(config({ collections: [{ slug: 'pages', fields: [] }] }))).toBe(
			'users'
		)
	})
})

describe('selectCollections', () => {
	it('keeps a collection that is present and authenticated, without warning', () => {
		const { collections, warnings } = select([slug('customers')])

		expect(collections.map(({ slug: entry }) => entry)).toEqual(['customers'])
		expect(warnings).toEqual([])
	})

	it('skips a collection missing from the config and says why', () => {
		const { collections, warnings } = select([slug('ghosts'), slug('customers')])

		// Absent here usually means a later plugin adds it, which is a load-order problem
		// rather than a broken config, so the rest of the list still applies.
		expect(collections.map(({ slug: entry }) => entry)).toEqual(['customers'])
		expect(warnings).toHaveLength(1)
		expect(warnings[0]).toMatch(/list dualSession after that plugin/)
	})

	it('skips a collection without auth', () => {
		const { collections, warnings } = select([slug('pages')])

		expect(collections).toEqual([])
		expect(warnings[0]).toMatch(/does not have auth enabled/)
	})

	it('keeps an `endpoints: false` collection but warns it has nothing to shadow', () => {
		const { collections, warnings } = select([slug('kiosks')])

		// Core answers 501 for every route on such a collection with or without this plugin,
		// and a custom login route can still mint the isolated cookie.
		expect(collections.map(({ slug: entry }) => entry)).toEqual(['kiosks'])
		expect(warnings[0]).toMatch(/no REST auth routes to shadow/)
	})

	it('refuses to isolate the collection backing the admin panel', () => {
		expect(() => select([slug('users')])).toThrow(/backs the admin panel/)
	})

	it('resolves the admin collection it protects from the caller, not from the slug', () => {
		// `admin.user` may name any collection, so the guard has to follow it rather than
		// assume the conventional name.
		expect(() => select([slug('customers')], 'customers')).toThrow(/backs the admin panel/)
	})
})
