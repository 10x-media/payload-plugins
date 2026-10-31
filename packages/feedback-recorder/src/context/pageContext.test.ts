import { describe, expect, it } from 'vitest'

import { parseAdminLocation } from './pageContext'

describe('parseAdminLocation', () => {
	it('reads a collection document', () => {
		expect(
			parseAdminLocation({ pathname: '/admin/collections/pages/abc123', adminRoute: '/admin' })
		).toEqual({ kind: 'collection', collection: 'pages', docId: 'abc123' })
	})

	it('treats the create view as a collection without a document', () => {
		expect(
			parseAdminLocation({ pathname: '/admin/collections/pages/create', adminRoute: '/admin' })
		).toEqual({ kind: 'collection', collection: 'pages' })
	})

	it('reads a collection list', () => {
		expect(
			parseAdminLocation({ pathname: '/admin/collections/events', adminRoute: '/admin' })
		).toEqual({ kind: 'collection', collection: 'events' })
	})

	it('reads a global', () => {
		expect(
			parseAdminLocation({ pathname: '/admin/globals/general-settings', adminRoute: '/admin' })
		).toEqual({ kind: 'global', global: 'general-settings' })
	})

	it('honours a custom admin route with a trailing slash', () => {
		expect(
			parseAdminLocation({ pathname: '/cms/collections/media/42', adminRoute: '/cms/' })
		).toEqual({ kind: 'collection', collection: 'media', docId: '42' })
	})

	it('falls back to other for the dashboard and foreign paths', () => {
		expect(parseAdminLocation({ pathname: '/admin', adminRoute: '/admin' })).toEqual({
			kind: 'other',
		})
		expect(parseAdminLocation({ pathname: '/administrator/x', adminRoute: '/admin' })).toEqual({
			kind: 'other',
		})
	})

	it('decodes encoded segments', () => {
		expect(
			parseAdminLocation({ pathname: '/admin/collections/pages/a%20b', adminRoute: '/admin' })
		).toEqual({ kind: 'collection', collection: 'pages', docId: 'a b' })
	})
})
