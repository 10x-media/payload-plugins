import { describe, expect, it } from 'vitest'

import { filterConditions, parseFilters, splitRef } from './filterQuery'

const ctx = {}

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

	it('pairs a picked user with its collection and matches a typed id in any', () => {
		expect(filterConditions({ users: ['customers:1'] }, ctx)).toEqual([
			{ and: [{ 'user.relationTo': { equals: 'customers' } }, { 'user.value': { equals: '1' } }] },
		])
		expect(filterConditions({ users: ['customers:1', '2'] }, ctx)).toEqual([
			{
				or: [
					{
						and: [
							{ 'user.relationTo': { equals: 'customers' } },
							{ 'user.value': { equals: '1' } },
						],
					},
					{ 'user.value': { equals: '2' } },
				],
			},
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

	it('matches any of the picked APIs', () => {
		expect(filterConditions({ apis: ['REST', 'MCP'] }, ctx)).toEqual([
			{ payloadAPI: { in: ['REST', 'MCP'] } },
		])
	})

	it('lets a locked tenant override the tenant filter', () => {
		expect(filterConditions({ tenants: ['a'] }, { ...ctx, lockedTenantId: 'b' })).toEqual([
			{ tenant: { equals: 'b' } },
		])
	})
})

describe('declared filters', () => {
	const customFilters = [{ name: 'department', path: 'actorDepartments' }]

	it('reads only declared names under the prefix', () => {
		expect(
			parseFilters(
				{ 'f.department': ['a', 'b'], 'f.unknown': 'x' },
				{ customFilterNames: ['department'] }
			).custom
		).toEqual({ department: ['a', 'b'] })
	})

	it('leaves custom unset when no declared filter has a value', () => {
		expect(parseFilters({}, { customFilterNames: ['department'] }).custom).toBeUndefined()
	})

	it('matches the declared path with in, one value or several', () => {
		expect(filterConditions({ custom: { department: ['a'] } }, { customFilters })).toEqual([
			{ actorDepartments: { in: ['a'] } },
		])
	})

	it('never builds a condition for a name that was not declared', () => {
		expect(filterConditions({ custom: { other: ['a'] } }, { customFilters })).toEqual([])
	})
})
