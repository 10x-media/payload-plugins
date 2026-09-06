import { describe, expect, it } from 'vitest'
import { resolvePrecision } from './precision'

describe('resolvePrecision', () => {
	it('defaults to readable with quantize entry, display drafts, and storage 6', () => {
		expect(resolvePrecision([undefined, undefined])).toEqual({
			draft: 'display',
			entry: 'quantize',
			mode: 'readable',
			storage: 6,
		})
	})
	it('expands the exact preset to free entry and faithful drafts', () => {
		expect(resolvePrecision([undefined, 'exact'])).toEqual({
			draft: 'faithful',
			entry: 'free',
			mode: 'exact',
			storage: 6,
		})
	})
	it('a later layer wins the mode outright', () => {
		expect(resolvePrecision(['exact', 'readable'])).toMatchObject({ mode: 'readable' })
		expect(resolvePrecision(['readable', 'exact'])).toMatchObject({ mode: 'exact' })
	})
	it('merges per knob: an explicit entry/draft survives a later mode switch', () => {
		const resolved = resolvePrecision([{ entry: 'quantize', mode: 'exact' }, { mode: 'readable' }])
		// mode switched to readable, but the plugin's explicit entry override is not a mode default
		expect(resolved).toEqual({ draft: 'display', entry: 'quantize', mode: 'readable', storage: 6 })
	})
	it('a later layer storage knob wins', () => {
		expect(resolvePrecision([{ storage: 2 }, { storage: 0 }])).toMatchObject({ storage: 0 })
		expect(resolvePrecision([{ storage: 2 }, undefined])).toMatchObject({ storage: 2 })
	})
	it('merges display per unit, later layer winning per key', () => {
		const resolved = resolvePrecision([{ display: { kg: 1, lb: 0 } }, { display: { kg: 3 } }])
		expect(resolved.display).toEqual({ kg: 3, lb: 0 })
	})
	it('ignores every undefined layer', () => {
		expect(resolvePrecision([undefined, undefined, undefined])).toEqual({
			draft: 'display',
			entry: 'quantize',
			mode: 'readable',
			storage: 6,
		})
	})
	it('throws when storage is not an integer', () => {
		expect(() => resolvePrecision([{ storage: 1.5 }])).toThrow(/storage/)
	})
	it('throws when storage is out of the 0..12 range', () => {
		expect(() => resolvePrecision([{ storage: -1 }])).toThrow(/storage/)
		expect(() => resolvePrecision([{ storage: 13 }])).toThrow(/storage/)
	})
	it('accepts storage 0 and storage 12 as the inclusive bounds', () => {
		expect(resolvePrecision([{ storage: 0 }])).toMatchObject({ storage: 0 })
		expect(resolvePrecision([{ storage: 12 }])).toMatchObject({ storage: 12 })
	})
	it('names the offending value in the storage error message', () => {
		expect(() => resolvePrecision([{ storage: 99 }])).toThrow(/99/)
	})
})
