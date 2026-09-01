import { describe, expect, it } from 'vitest'
import { commitDrafts, draftsFor, resolveDisplayUnit } from './editModel'

describe('draftsFor', () => {
	it('renders scalar display drafts rounded to display precision', () => {
		expect(draftsFor(81.646627, { displayUnit: 'lb', storageUnit: 'kg' })).toEqual({
			primary: '180',
			minor: '',
		})
		expect(draftsFor(81.646627, { displayUnit: 'kg', storageUnit: 'kg' })).toEqual({
			primary: '81.6',
			minor: '',
		})
	})
	it('renders compound drafts', () => {
		expect(draftsFor(180.34, { displayUnit: 'ft-in', storageUnit: 'cm' })).toEqual({
			primary: '5',
			minor: '11',
		})
	})
	it('renders null as empty', () => {
		expect(draftsFor(null, { displayUnit: 'kg', storageUnit: 'kg' })).toEqual({
			primary: '',
			minor: '',
		})
	})
})

describe('commitDrafts', () => {
	it('commits scalar input converted to storage and rounded to 6 digits', () => {
		expect(
			commitDrafts({ minor: '', primary: '180' }, { displayUnit: 'lb', storageUnit: 'kg' })
		).toBe(81.646627)
	})
	it('commits compound input', () => {
		expect(
			commitDrafts({ minor: '11', primary: '5' }, { displayUnit: 'ft-in', storageUnit: 'cm' })
		).toBe(180.34)
	})
	it('treats an empty minor as zero', () => {
		expect(
			commitDrafts({ minor: '', primary: '6' }, { displayUnit: 'ft-in', storageUnit: 'cm' })
		).toBeCloseTo(182.88, 4)
	})
	it('returns null for empty or unparseable primary', () => {
		expect(
			commitDrafts({ minor: '', primary: '' }, { displayUnit: 'kg', storageUnit: 'kg' })
		).toBeNull()
		expect(
			commitDrafts({ minor: '', primary: 'abc' }, { displayUnit: 'kg', storageUnit: 'kg' })
		).toBeNull()
	})
	it('round-trips what draftsFor rendered', () => {
		const drafts = draftsFor(81.646627, { displayUnit: 'lb', storageUnit: 'kg' })
		expect(commitDrafts(drafts, { displayUnit: 'lb', storageUnit: 'kg' })).toBe(81.646627)
	})
	it('clamps an out-of-range minor to the unit ceiling before composing', () => {
		expect(
			commitDrafts({ minor: '24', primary: '5' }, { displayUnit: 'ft-in', storageUnit: 'cm' })
		).toBeCloseTo(182.87746, 5)
	})
	it('clamps a negative minor to zero', () => {
		expect(
			commitDrafts({ minor: '-5', primary: '5' }, { displayUnit: 'ft-in', storageUnit: 'cm' })
		).toBeCloseTo(152.4, 4)
	})
})

describe('resolveDisplayUnit', () => {
	const units = ['kg', 'lb', 'st-lb'] as const
	it('prefers the user preference when offered', () => {
		expect(resolveDisplayUnit({ preferenceUnit: 'lb', units: [...units] })).toBe('lb')
	})
	it('skips a preference the field does not offer', () => {
		expect(resolveDisplayUnit({ defaultUnit: 'kg', preferenceUnit: 'mi', units: [...units] })).toBe(
			'kg'
		)
	})
	it('walks preference, field default, registry default, locale, first unit', () => {
		expect(resolveDisplayUnit({ localeUnit: 'st-lb', units: [...units] })).toBe('st-lb')
		expect(resolveDisplayUnit({ units: [...units] })).toBe('kg')
	})
})
