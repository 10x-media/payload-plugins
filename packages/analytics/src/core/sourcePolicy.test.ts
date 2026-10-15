import { describe, expect, it } from 'vitest'
import { memoryAdapter } from '../testing/memoryAdapter'
import type { AnalyticsAdapter } from './contract'
import { type AnalyticsPluginOptions, resolveOptions } from './options'

const narrowing: AnalyticsAdapter = {
	...memoryAdapter(),
	id: 'shared',
	capabilities: { ...memoryAdapter().capabilities, scopedQueries: true },
}
const wide = memoryAdapter()
const scope = { resolve: () => 'tenant-a', member: () => true }

const resolve = (options: Partial<AnalyticsPluginOptions>) => () =>
	resolveOptions({ adapters: [narrowing, wide], scope, ...options })

describe('sources and defaultSource', () => {
	it('resolves no policy and no rule when both are unset', () => {
		const { sources } = resolve({})()
		expect(sources.policies.size).toBe(0)
		expect(sources.defaultSource).toBeUndefined()
	})

	it('keeps every policy but staff, which is what no policy means', () => {
		const pick = () => true
		const { sources } = resolve({
			sources: { shared: { tenants: 'fallback' }, memory: { tenants: 'staff' } },
			defaultSource: 'tenantFirst',
		})()
		expect([...sources.policies]).toEqual([['shared', 'fallback']])
		expect(sources.defaultSource).toBe('tenantFirst')
		expect(
			resolve({ sources: { shared: { tenants: pick } } })().sources.policies.get('shared')
		).toBe(pick)
	})

	it.each([
		['sources', { sources: { shared: { tenants: 'tenant' } } }],
		['defaultSource', { defaultSource: 'platformFirst' }],
	] as const)('refuses %s on an unscoped install', (path, options) => {
		expect(() => resolveOptions({ adapters: [narrowing], ...options })).toThrow(
			new RegExp(`analytics: ${path} only applies to a scoped install`)
		)
	})

	it('refuses a key naming no config adapter', () => {
		expect(resolve({ sources: { 'plausible:42': { tenants: 'tenant' } } })).toThrow(
			/analytics: sources\.plausible:42 names no adapter in adapters, whose ids are "shared" and "memory"/
		)
	})

	it('refuses a policy it does not know, and an entry with other keys', () => {
		expect(resolve({ sources: { shared: { tenants: 'everyone' as never } } })).toThrow(
			/analytics: sources\.shared\.tenants must be 'staff', 'tenant', 'fallback' or a function, got "everyone"/
		)
		expect(resolve({ sources: { shared: { readers: 'tenant' } as never } })).toThrow(
			/sources\.shared/
		)
		expect(resolve({ sources: 'shared' as never })).toThrow(
			/analytics: sources must be an object keyed by adapter id/
		)
	})

	// A tenant reading an adapter that cannot narrow would be shown every tenant's totals.
	it.each([
		'tenant',
		'fallback',
		() => true,
	] as const)('refuses %s on an adapter without scopedQueries, naming the option and why', (tenants) => {
		expect(resolve({ sources: { memory: { tenants } } })).toThrow(
			/analytics: sources\.memory\.tenants .*cannot narrow a query to one scope .*every tenant's totals/
		)
	})

	it('lets staff stand on an adapter that cannot narrow', () => {
		expect(resolve({ sources: { memory: { tenants: 'staff' } } })).not.toThrow()
	})

	it('refuses a defaultSource it does not know', () => {
		expect(resolve({ defaultSource: 'newest' as never })).toThrow(
			/analytics: defaultSource must be 'tenantFirst', 'platformFirst' or a function, got "newest"/
		)
	})
	it('refuses platformFirst without a platformAdapter to put first', () => {
		expect(resolve({ defaultSource: 'platformFirst' })).toThrow(
			/analytics: defaultSource 'platformFirst' .*platformAdapter, which is not set/
		)
		expect(resolve({ defaultSource: 'platformFirst', platformAdapter: 'shared' })).not.toThrow()
	})
})
