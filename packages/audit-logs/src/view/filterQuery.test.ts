import { describe, expect, it } from 'vitest'

import { filterConditions, parseFilters, splitRef } from './filterQuery'

const ctx = { userCollections: ['users'] }

describe('splitRef', () => {
	it('splits a picked reference and keeps a typed id whole', () => {
		expect(splitRef('posts:42')).toEqual({ id: '42', slug: 'posts' })
		expect(splitRef('42')).toEqual({ id: '42' })
	})
})

describe('parseFilters', () => {
	it('reads repeated keys as lists', () => {
		expect(
			parseFilters({ eventType: ['order_paid', 'order_refunded'], group: 'a', userId: 'users:1' })
		).toMatchObject({
			eventTypes: ['order_paid', 'order_refunded'],
			groups: ['a'],
			users: ['users:1'],
		})
	})

	it('keeps documents alongside globals', () => {
		expect(parseFilters({ documentId: '1', global: 'site-settings' }).documents).toEqual(['1'])
	})

	it('drops the tenant filter in the tenant view', () => {
		expect(parseFilters({ tenant: 't1' }, { useTenant: true }).tenants).toBeUndefined()
	})
})

describe('filterConditions', () => {
	it('matches any picked event, whole operations and single types alike', () => {
		expect(filterConditions({ eventTypes: ['order_paid'], operations: ['create'] }, ctx)).toEqual([
			{ or: [{ operation: { equals: 'create' } }, { eventType: { equals: 'order_paid' } }] },
		])
	})

	it('pairs a picked document with its collection and matches a typed id anywhere', () => {
		expect(filterConditions({ documents: ['posts:42', '7', '8'] }, ctx)).toEqual([
			{
				or: [
					{ and: [{ relationTo: { equals: 'posts' } }, { documentId: { equals: '42' } }] },
					{ documentId: { in: ['7', '8'] } },
				],
			},
		])
	})

	it('pairs users with their collection only when user is polymorphic', () => {
		expect(filterConditions({ users: ['users:1', '2'] }, ctx)).toEqual([
			{ user: { in: ['1', '2'] } },
		])
		expect(
			filterConditions({ users: ['customers:1'] }, { userCollections: ['users', 'customers'] })
		).toEqual([
			{ and: [{ 'user.relationTo': { equals: 'customers' } }, { 'user.value': { equals: '1' } }] },
		])
	})

	it('bounds the date range on both ends', () => {
		expect(filterConditions({ dateFrom: '2026-09-01', dateTo: '2026-09-30' }, ctx)).toEqual([
			{ createdAt: { greater_than_equal: '2026-09-01' } },
			{ createdAt: { less_than_equal: '2026-09-30' } },
		])
	})

	it('narrows the collection side with documents and keeps globals beside it', () => {
		expect(
			filterConditions(
				{ collections: ['posts'], documents: ['posts:42'], globals: ['site-settings'] },
				ctx
			)
		).toEqual([
			{
				or: [
					{
						and: [
							{ relationTo: { equals: 'posts' } },
							{ and: [{ relationTo: { equals: 'posts' } }, { documentId: { equals: '42' } }] },
						],
					},
					{
						and: [
							{ relationTo: { equals: '__global__' } },
							{ documentId: { equals: 'site-settings' } },
						],
					},
				],
			},
		])
	})

	it('lets a locked tenant override the tenant filter', () => {
		expect(filterConditions({ tenants: ['a'] }, { ...ctx, lockedTenantId: 'b' })).toEqual([
			{ tenant: { equals: 'b' } },
		])
	})
})
