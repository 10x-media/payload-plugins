import type { Payload } from 'payload'
import { describe, expect, it } from 'vitest'

import type { MatchFieldConfig } from '../options'
import { getCollectionContext, hashMatch, matchFields, tenantOf } from './context'

const base: MatchFieldConfig[] = [
	{ path: 'email', weight: 45 },
	{ path: 'name', weight: 40, compare: 'text' },
]

describe('hashMatch', () => {
	it('changes when a preset changes, so keys computed by the old one go stale', () => {
		const exact = hashMatch([
			{ path: 'email', weight: 45 },
			{ path: 'name', weight: 40, compare: 'exact' },
		])
		expect(exact).not.toBe(hashMatch(base))
	})

	it('stays the same when only a weight or a penalty changes: keys do not depend on them', () => {
		expect(
			hashMatch([
				{ ...base[0], weight: 10, onDiffer: 'veto' } as MatchFieldConfig,
				base[1] as MatchFieldConfig,
			])
		).toBe(hashMatch(base))
	})

	it('tells two custom key functions apart', () => {
		const one = hashMatch([
			{ path: 'x', weight: 1, compare: { keys: (v) => [String(v)], similarity: () => 1 } },
		])
		const two = hashMatch([
			{
				path: 'x',
				weight: 1,
				compare: { keys: (v) => [String(v).toLowerCase()], similarity: () => 1 },
			},
		])
		expect(one).not.toBe(two)
	})

	it('is stable for the same config', () => {
		expect(hashMatch(base)).toBe(hashMatch([...base]))
	})
})

describe('getCollectionContext', () => {
	it('refuses an unconfigured collection as a bad request, not a crash', () => {
		// Only what getCollectionContext reads: the same shape buildContext writes.
		const payload = {
			[Symbol.for('@10x-media/dedupe/context')]: { collections: new Map([['customers', {}]]) },
		} as unknown as Payload
		expect(() => getCollectionContext(payload, 'ghosts')).toThrow(
			expect.objectContaining({ status: 400 })
		)
	})
})

// Only what the adapter helpers read: the same shape buildContext writes.
const withContext = (context: Record<string, unknown>) =>
	({ [Symbol.for('@10x-media/dedupe/context')]: context }) as unknown as Payload

describe('matchFields', () => {
	it('lists the match fields as the config gave them, presets by name', () => {
		const payload = withContext({
			collections: new Map([['customers', { options: { match: { fields: base } } }]]),
		})
		expect(matchFields(payload, 'customers')).toEqual(base)
	})

	it('is empty for a collection merged by hand only', () => {
		const payload = withContext({
			collections: new Map([['leads', { options: { match: null } }]]),
		})
		expect(matchFields(payload, 'leads')).toEqual([])
	})
})

describe('tenantOf', () => {
	const tenanted = withContext({
		tenantFieldName: 'tenant',
		collections: new Map([
			['customers', { tenanted: true }],
			['staff', { tenanted: false }],
		]),
	})

	it('reads the tenant id whatever shape the relationship arrived in', () => {
		expect(tenantOf(tenanted, 'customers', { tenant: 'kyiv' })).toBe('kyiv')
		expect(tenantOf(tenanted, 'customers', { tenant: 7 })).toBe('7')
		expect(tenantOf(tenanted, 'customers', { tenant: { id: 7, name: 'Kyiv' } })).toBe('7')
	})

	it('is null for a document without a tenant', () => {
		expect(tenantOf(tenanted, 'customers', {})).toBeNull()
		expect(tenantOf(tenanted, 'customers', { tenant: null })).toBeNull()
	})

	it('is null in a collection that is not tenant-scoped, whatever its tenant field holds', () => {
		expect(tenantOf(tenanted, 'staff', { tenant: 'kyiv' })).toBeNull()
	})

	it('is null with multiTenancy off', () => {
		const off = withContext({
			tenantFieldName: null,
			collections: new Map([['customers', { tenanted: false }]]),
		})
		expect(tenantOf(off, 'customers', { tenant: 'kyiv' })).toBeNull()
	})
})
