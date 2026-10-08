import { describe, expect, it } from 'vitest'

import { DEFAULT_MAX_BUCKET, DEFAULT_MIN_SCORE, type MatchConfig, resolveOptions } from './options'

describe('resolveOptions', () => {
	it('leaves out a collection set to `false`', () => {
		expect(resolveOptions({ collections: { customers: false } }).collections).toEqual([])
	})

	it('normalizes `true` to a manual-merge collection', () => {
		const resolved = resolveOptions({ collections: { customers: true } })
		expect(resolved.collections).toEqual([
			{
				slug: 'customers',
				match: null,
				fields: undefined,
				absorbed: undefined,
				draft: false,
				checkOnSave: false,
			},
		])
	})

	it('refuses a collection the multi-tenant plugin keeps one document of per tenant', () => {
		const multiTenancy = { collections: { settings: { isGlobal: true }, customers: {} } }
		expect(() => resolveOptions({ multiTenancy, collections: { settings: true } })).toThrow(
			/"settings".*isGlobal/
		)
		expect(
			resolveOptions({ multiTenancy, collections: { customers: true } }).tenantCollections
		).toEqual(['settings', 'customers'])
	})

	it('refuses an adapter on a collection without a match, which never searches', () => {
		expect(() => resolveOptions({ collections: { leads: { adapter: (base) => base } } })).toThrow(
			/adapter.*match/
		)
	})

	it('fills match defaults and turns the save hook on', () => {
		const resolved = resolveOptions({
			collections: { customers: { match: { fields: [{ path: 'email', weight: 1 }] } } },
		})
		expect(resolved.collections[0]?.match).toMatchObject({
			minScore: DEFAULT_MIN_SCORE,
			maxBucket: DEFAULT_MAX_BUCKET,
		})
		expect(resolved.collections[0]?.checkOnSave).toBe(true)
	})

	it('refuses an empty match', () => {
		expect(() => resolveOptions({ collections: { customers: { match: { fields: [] } } } })).toThrow(
			/at least one field/
		)
	})

	describe('validates the match config', () => {
		const withMatch = (match: unknown) => () =>
			resolveOptions({ collections: { customers: { match: match as MatchConfig } } })
		const field = (extra: Record<string, unknown>) => ({ path: 'email', weight: 1, ...extra })

		it('accepts a valid config', () => {
			expect(
				withMatch({
					fields: [
						{ path: 'email', weight: 45 },
						{ path: 'name', weight: 40, compare: 'text', onDiffer: 'veto' },
						{ path: 'mobile', weight: 30, compare: 'phone' },
						{
							path: 'amount',
							weight: 5,
							compare: 'number',
							toleranceType: 'quantity',
							tolerance: 10,
						},
						{
							path: 'phone',
							weight: 35,
							compare: { keys: () => [], similarity: () => 0 },
							key: false,
						},
						{ path: 'birthDate', weight: 0.5, compare: 'date', onDiffer: -25 },
					],
					minScore: 0,
					maxBucket: 2,
					candidateLimit: 1,
				})
			).not.toThrow()
		})

		it.each([
			['an empty path', field({ path: '' }), /path/],
			['a zero weight', field({ weight: 0 }), /weight/],
			['a negative weight', field({ weight: -1 }), /weight/],
			['an infinite weight', field({ weight: Number.POSITIVE_INFINITY }), /weight/],
			[
				'a tolerance on a field that is not a number',
				field({ compare: 'text', tolerance: 5 }),
				/tolerance/,
			],
			[
				'a tolerance type on a field that is not a number',
				field({ toleranceType: 'value' }),
				/toleranceType/,
			],
			['a negative tolerance', field({ compare: 'number', tolerance: -1 }), /tolerance/],
			['a tolerance above 100', field({ compare: 'number', tolerance: 101 }), /tolerance/],
			['a positive onDiffer', field({ onDiffer: 5 }), /onDiffer/],
			['typos on a field that is not text', field({ compare: 'number', typos: true }), /typos/],
		])('refuses %s', (_name, bad, message) => {
			expect(withMatch({ fields: [bad] })).toThrow(message)
		})

		it('refuses the same path twice', () => {
			expect(withMatch({ fields: [field({}), field({ weight: 2 })] })).toThrow(/twice/)
		})

		it('refuses a config where no field produces keys', () => {
			expect(withMatch({ fields: [field({ key: false })] })).toThrow(/key/)
		})

		it.each([
			['minScore above 1', { minScore: 1.5 }, /minScore/],
			['a negative minScore', { minScore: -0.1 }, /minScore/],
			['a fractional maxBucket', { maxBucket: 10.5 }, /maxBucket/],
			['maxBucket below 2', { maxBucket: 1 }, /maxBucket/],
			['candidateLimit of 0', { candidateLimit: 0 }, /candidateLimit/],
		])('refuses %s', (_name, extra, message) => {
			expect(withMatch({ fields: [field({})], ...extra })).toThrow(message)
		})
	})

	it('resolves tenancy, events, overrides and the scan cron', () => {
		const events = { emit: () => undefined }
		const resolved = resolveOptions({
			multiTenancy: true,
			events,
			scan: { cron: '0 3 * * *' },
			overrides: { pairs: (collection) => collection },
		})
		expect(resolved.tenantFieldName).toBe('tenant')
		expect(resolved.events).toBe(events)
		expect(resolved.scanCron).toBe('0 3 * * *')
		expect(resolved.overrides.pairs).toBeDefined()
		expect(resolveOptions({ multiTenancy: { tenantFieldName: 'org' } }).tenantFieldName).toBe('org')
		expect(resolveOptions({}).tenantFieldName).toBeNull()
	})

	it('defaults the view path and validates a custom one', () => {
		expect(resolveOptions({}).view).toEqual({ path: '/dedupe' })
		expect(resolveOptions({ view: { path: '/duplicates' } }).view).toEqual({ path: '/duplicates' })
		expect(resolveOptions({ view: false }).view).toBe(false)
		expect(() => resolveOptions({ view: { path: 'dedupe' as `/${string}` } })).toThrow(/slash/)
	})
})
