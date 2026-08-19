import type { CollectionConfig, CollectionSlug, Config, TypedUser } from 'payload'
import { describe, expect, it } from 'vitest'

import type { DualSessionPluginOptions } from '../types'
import { resolveAdminUserSlug, selectCollections } from './selectCollections'

const slug = (value: string) => value as CollectionSlug

/** Stands in for `checkRole(['admin'], user)` in a role-split project. */
const isStaff = (user: TypedUser) => !(user as { roles?: string[] }).roles?.includes('admin')

const incoming: CollectionConfig[] = [
	{ slug: 'users', auth: true, fields: [] },
	{ slug: 'customers', auth: true, fields: [] },
	{ slug: 'pages', fields: [] },
	{ slug: 'kiosks', auth: true, endpoints: false, fields: [] },
]

const select = (collections: DualSessionPluginOptions['collections'], adminUserSlug = 'users') =>
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

	it('refuses to isolate the collection backing the admin panel wholesale', () => {
		expect(() => select([slug('users')])).toThrow(/isolate` predicate/)
	})

	it('resolves the admin collection it protects from the caller, not from the slug', () => {
		// `admin.user` may name any collection, so the guard has to follow it rather than
		// assume the conventional name.
		expect(() => select([slug('customers')], 'customers')).toThrow(/backs the admin panel/)
	})

	it('accepts the admin collection once an `isolate` predicate says who moves', () => {
		// Role-split: admins keep the shared cookie, everyone else gets a second one, so the
		// admin panel is never left without a session to read.
		const { collections, warnings } = select([{ slug: slug('users'), isolate: isStaff }])

		expect(collections.map(({ slug: entry }) => entry)).toEqual(['users'])
		expect(warnings).toEqual([])
	})

	it('refuses to let the admin collection own an admin-scoped isolated cookie', () => {
		// The isolated strategy runs ahead of core's `local-jwt`, so this would let a staff
		// cookie answer admin-panel requests in place of the admin's own session.
		expect(() =>
			select([{ slug: slug('users'), isolate: isStaff, scopes: ['admin', 'frontend'] }])
		).toThrow(/must not carry the "admin" scope/)
	})

	it('leaves the admin scope available to collections that do not back the panel', () => {
		const { collections } = select([{ slug: slug('customers'), scopes: ['admin', 'frontend'] }])

		expect(collections[0]?.scopes).toEqual(['admin', 'frontend'])
	})
})
