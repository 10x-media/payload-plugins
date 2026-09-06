import { describe, expect, it } from 'vitest'
import { roundTo } from '../engine/convert'
import { createEngine, defaultEngine } from '../engine/registry'
import { commitDrafts, draftsFor, resolveDisplayUnit } from './editModel'

const engine = defaultEngine
const nauticalEngine = createEngine({
	units: { nmi: { dimension: 'length', factor: 1852, intlUnit: null, shortLabel: 'nmi' } },
})

describe('draftsFor', () => {
	describe('faithful draft policy', () => {
		it('keeps the display-precision draft when it round-trips to the stored value', () => {
			expect(
				draftsFor(81.646627, { displayUnit: 'lb', draft: 'faithful', engine, storageUnit: 'kg' })
			).toEqual({
				primary: '180',
				minor: '',
			})
		})
		it('escalates fraction digits until the draft reproduces the stored value', () => {
			// cm displays at 0 digits, so a faithful draft has to outgrow display precision
			expect(
				draftsFor(180.34, { displayUnit: 'cm', draft: 'faithful', engine, storageUnit: 'cm' })
			).toEqual({
				primary: '180.34',
				minor: '',
			})
			expect(
				draftsFor(81.646627, { displayUnit: 'kg', draft: 'faithful', engine, storageUnit: 'kg' })
			).toEqual({
				primary: '81.646627',
				minor: '',
			})
		})
		it('keeps compound parts short when they already round-trip', () => {
			expect(
				draftsFor(180.34, { displayUnit: 'ft-in', draft: 'faithful', engine, storageUnit: 'cm' })
			).toEqual({
				primary: '5',
				minor: '11',
			})
		})
		it('escalates the minor part of a compound draft', () => {
			const opts = { displayUnit: 'ft-in', draft: 'faithful', engine, storageUnit: 'cm' } as const
			const drafts = draftsFor(180.5, opts)
			expect(drafts.primary).toBe('5')
			expect(Number(drafts.minor)).toBeGreaterThan(11)
			expect(commitDrafts(drafts, opts)).toBe(180.5)
		})
		it('honours a precision override before escalating', () => {
			expect(
				draftsFor(180.34, {
					displayUnit: 'cm',
					draft: 'faithful',
					engine,
					precision: { cm: 2 },
					storageUnit: 'cm',
				})
			).toEqual({ primary: '180.34', minor: '' })
		})
		it('renders null as empty', () => {
			expect(
				draftsFor(null, { displayUnit: 'kg', draft: 'faithful', engine, storageUnit: 'kg' })
			).toEqual({
				primary: '',
				minor: '',
			})
		})
		it('drives custom units through the engine it is given', () => {
			const opts = {
				displayUnit: 'nmi',
				draft: 'faithful',
				engine: nauticalEngine,
				storageUnit: 'm',
			} as const
			expect(draftsFor(1852, opts)).toEqual({ primary: '1', minor: '' })
			const drafts = draftsFor(926, opts)
			expect(drafts).toEqual({ primary: '0.5', minor: '' })
			expect(commitDrafts(drafts, opts)).toBe(926)
		})
		it('defaults to faithful when no draft policy is given', () => {
			expect(draftsFor(180.34, { displayUnit: 'cm', engine, storageUnit: 'cm' })).toEqual({
				primary: '180.34',
				minor: '',
			})
		})
	})

	describe('display draft policy', () => {
		it('renders straight at display digits with no escalation', () => {
			expect(
				draftsFor(180.34, { displayUnit: 'cm', draft: 'display', engine, storageUnit: 'cm' })
			).toEqual({ primary: '180', minor: '' })
		})
		it('renders each compound part at its own digits', () => {
			// 180.34 cm is exactly 71 in, so both policies agree on the split here;
			// the point of this test is that 'display' never escalates past digit 0.
			expect(
				draftsFor(180.34, { displayUnit: 'ft-in', draft: 'display', engine, storageUnit: 'cm' })
			).toEqual({ primary: '5', minor: '11' })
		})
		it('renders null as empty', () => {
			expect(
				draftsFor(null, { displayUnit: 'kg', draft: 'display', engine, storageUnit: 'kg' })
			).toEqual({ primary: '', minor: '' })
		})
	})

	it('ignores foreign CommitOptions fields on its own options object when probing the round-trip', () => {
		// The escalation probe must build its own bare UnitContext rather than forward
		// `opts`: a caller sharing one object between draftsFor and commitDrafts could
		// otherwise poison the round-trip check with an entry/dirty/storedValue field.
		const clean = { displayUnit: 'ft-in', draft: 'faithful', engine, storageUnit: 'cm' } as const
		const expected = draftsFor(180.5, clean)
		const poisoned = {
			...clean,
			dirty: { minor: false, primary: false },
			entry: 'quantize',
			storedValue: 999,
		} as const
		expect(draftsFor(180.5, poisoned)).toEqual(expected)
	})
})

describe('commitDrafts', () => {
	it('commits scalar input converted to storage and rounded to 6 digits', () => {
		expect(
			commitDrafts({ minor: '', primary: '180' }, { displayUnit: 'lb', engine, storageUnit: 'kg' })
		).toBe(81.646627)
	})
	it('commits compound input', () => {
		expect(
			commitDrafts(
				{ minor: '11', primary: '5' },
				{ displayUnit: 'ft-in', engine, storageUnit: 'cm' }
			)
		).toBe(180.34)
	})
	it('treats an empty minor as zero', () => {
		expect(
			commitDrafts({ minor: '', primary: '6' }, { displayUnit: 'ft-in', engine, storageUnit: 'cm' })
		).toBeCloseTo(182.88, 4)
	})
	it('returns null for empty or unparseable primary', () => {
		expect(
			commitDrafts({ minor: '', primary: '' }, { displayUnit: 'kg', engine, storageUnit: 'kg' })
		).toBeNull()
		expect(
			commitDrafts({ minor: '', primary: 'abc' }, { displayUnit: 'kg', engine, storageUnit: 'kg' })
		).toBeNull()
	})
	it('round-trips what draftsFor rendered', () => {
		const opts = { displayUnit: 'lb', draft: 'faithful', engine, storageUnit: 'kg' } as const
		expect(commitDrafts(draftsFor(81.646627, opts), opts)).toBe(81.646627)
	})
	it('clamps an out-of-range minor to the unit ceiling before composing', () => {
		expect(
			commitDrafts(
				{ minor: '24', primary: '5' },
				{ displayUnit: 'ft-in', engine, storageUnit: 'cm' }
			)
		).toBeCloseTo(182.87746, 5)
	})
	it('round-trips a negative compound value', () => {
		const opts = { displayUnit: 'ft-in', draft: 'faithful', engine, storageUnit: 'cm' } as const
		const drafts = draftsFor(-200.66, opts)
		expect(drafts).toEqual({ minor: '-7', primary: '-6' })
		expect(commitDrafts(drafts, opts)).toBeCloseTo(-200.66, 6)
	})
	it('clamps a negative minor magnitude to the unit ceiling', () => {
		expect(
			commitDrafts(
				{ minor: '-24', primary: '-5' },
				{ displayUnit: 'ft-in', engine, storageUnit: 'cm' }
			)
		).toBeCloseTo(-182.87746, 5)
	})

	describe('dirty guard', () => {
		it('leaves a scalar value unchanged when its only input is untouched', () => {
			expect(
				commitDrafts(
					{ minor: '', primary: 'whatever the input still shows' },
					{
						dirty: { minor: false, primary: false },
						displayUnit: 'cm',
						engine,
						storageUnit: 'cm',
						storedValue: 180.34,
					}
				)
			).toBe(180.34)
		})
		it('derives an untouched compound major from the stored value, not its stale draft', () => {
			// 180.34 cm is exactly 71 in: stored decomposes to 5 ft (untouched) + 11 in.
			// Editing only the minor to 10 must still compose off that exact 5, not off
			// whatever the major input happens to be showing.
			expect(
				commitDrafts(
					{ minor: '10', primary: 'stale' },
					{
						dirty: { minor: true, primary: false },
						displayUnit: 'ft-in',
						engine,
						storageUnit: 'cm',
						storedValue: 180.34,
					}
				)
			).toBeCloseTo(177.8, 6)
		})
	})

	describe('entry quantization', () => {
		it('rounds a dirty scalar entry at display digits, in the entry unit, before converting', () => {
			// in displays at 1 digit: 71.437 in quantizes to 71.4 in before the exact conversion.
			expect(
				commitDrafts(
					{ minor: '', primary: '71.437' },
					{ displayUnit: 'in', engine, entry: 'quantize', storageUnit: 'cm' }
				)
			).toBeCloseTo(181.356, 6)
		})
		it('leaves free entry at full typed precision', () => {
			expect(
				commitDrafts(
					{ minor: '', primary: '71.437' },
					{ displayUnit: 'in', engine, entry: 'free', storageUnit: 'cm' }
				)
			).toBeCloseTo(181.44998, 5)
		})
		it('lets a quantized minor carry into the ratio instead of clamping it back down', () => {
			// The unit ceiling clamp bounds a raw typed value (a literal 24); it must
			// run before quantization, not after, or a legitimate carry like 11.96 -> 12
			// gets clamped straight back down to 11.999 and 182.88 prints as 182.87746.
			expect(
				commitDrafts(
					{ minor: '11.96', primary: '5' },
					{ displayUnit: 'ft-in', engine, entry: 'quantize', storageUnit: 'cm' }
				)
			).toBe(182.88)
		})
	})

	describe('carry-zone dirty guard (delta semantics)', () => {
		const opts = { displayUnit: 'ft-in', engine, storageUnit: 'cm' } as const
		const stored = 182.5

		it('paints the carry: 182.5 cm (5 ft 11.850394 in exactly) displays as 6 ft 0 in', () => {
			expect(draftsFor(stored, { ...opts, draft: 'display' })).toEqual({
				minor: '0',
				primary: '6',
			})
		})
		it('typing feet 6 -> 7 adds one foot to the exact stored total, not to the painted 6', () => {
			const painted = draftsFor(stored, { ...opts, draft: 'display' })
			const exact = engine.decompose(stored, 'cm', 'ft-in', 6)
			const exactTotal = exact.major * 12 + exact.minor
			const expected = roundTo(engine.convert(exactTotal + 12, 'in', 'cm'), 6)
			expect(
				commitDrafts(
					{ minor: painted.minor, primary: '7' },
					{
						...opts,
						dirty: { minor: false, primary: true },
						paintedDrafts: painted,
						storedValue: stored,
					}
				)
			).toBe(expected)
		})
		it('typing inches 0 -> 3 adds three inches to the exact stored total', () => {
			const painted = draftsFor(stored, { ...opts, draft: 'display' })
			const exact = engine.decompose(stored, 'cm', 'ft-in', 6)
			const exactTotal = exact.major * 12 + exact.minor
			const expected = roundTo(engine.convert(exactTotal + 3, 'in', 'cm'), 6)
			expect(
				commitDrafts(
					{ minor: '3', primary: painted.primary },
					{
						...opts,
						dirty: { minor: true, primary: false },
						paintedDrafts: painted,
						storedValue: stored,
					}
				)
			).toBe(expected)
		})
		it('never leaks the display carry into a no-op edit, across the carry boundary (sweep)', () => {
			for (let step = 0; step <= 200; step++) {
				const value = roundTo(170 + step * 0.1, 6)
				const painted = draftsFor(value, { ...opts, draft: 'display' })
				expect(
					commitDrafts(painted, {
						...opts,
						dirty: { minor: false, primary: true },
						paintedDrafts: painted,
						storedValue: value,
					})
				).toBeCloseTo(value, 5)
				expect(
					commitDrafts(painted, {
						...opts,
						dirty: { minor: true, primary: false },
						paintedDrafts: painted,
						storedValue: value,
					})
				).toBeCloseTo(value, 5)
			}
		})
	})

	describe('storage digits parameter', () => {
		it('rounds the commit to the resolved storage precision, not the fixed default', () => {
			expect(
				commitDrafts(
					{ minor: '', primary: '123.456' },
					{ displayUnit: 'g', engine, storageDigits: 0, storageUnit: 'g' }
				)
			).toBe(123)
		})
	})
})

describe('resolveDisplayUnit', () => {
	const units = ['kg', 'lb', 'st-lb'] as const
	const base = { dimension: 'mass', units: [...units] }
	it('prefers the user preference when offered', () => {
		expect(resolveDisplayUnit({ ...base, preferenceUnit: 'lb' })).toBe('lb')
	})
	it('skips a preference the field does not offer', () => {
		expect(resolveDisplayUnit({ ...base, fallbackUnit: 'kg', preferenceUnit: 'mi' })).toBe('kg')
	})
	it('walks preference, fallback, registry default, field locale defaults', () => {
		expect(resolveDisplayUnit({ ...base, fallbackUnit: 'st-lb', registryDefault: 'lb' })).toBe(
			'st-lb'
		)
		expect(
			resolveDisplayUnit({
				...base,
				localeDefaults: { us: 'st-lb' },
				registryDefault: 'lb',
				system: 'us',
			})
		).toBe('lb')
		expect(resolveDisplayUnit({ ...base, localeDefaults: { us: 'st-lb' }, system: 'us' })).toBe(
			'st-lb'
		)
	})
	it('falls through an unavailable field locale default to the dimension table', () => {
		expect(resolveDisplayUnit({ ...base, localeDefaults: { us: 'oz' }, system: 'us' })).toBe('lb')
	})
	it('uses the dimension table when the field declares no locale defaults', () => {
		expect(resolveDisplayUnit({ ...base, system: 'metric' })).toBe('kg')
		expect(
			resolveDisplayUnit({ dimension: 'length', system: 'us', units: ['cm', 'in', 'ft-in'] })
		).toBe('in')
	})
	it('ignores the locale steps before the system is known', () => {
		expect(resolveDisplayUnit({ ...base, localeDefaults: { us: 'lb' }, system: null })).toBe('kg')
	})
	it('lands on the first unit for a dimension with no table entry', () => {
		expect(
			resolveDisplayUnit({ dimension: 'distance-at-sea', system: 'metric', units: ['nmi', 'km'] })
		).toBe('nmi')
	})
})
