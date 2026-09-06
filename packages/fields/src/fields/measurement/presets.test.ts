import { describe, expect, it } from 'vitest'
import { dimensionOf, isScalarUnit, UNITS } from './engine/units'
import type { MeasurementPreset } from './presets'
import { presets } from './presets'

describe('presets', () => {
	it('keeps every preset internally consistent', () => {
		for (const [key, preset] of Object.entries(presets)) {
			expect(isScalarUnit(preset.storageUnit), key).toBe(true)
			const dimension = UNITS[preset.storageUnit].dimension
			for (const unit of preset.units) expect(dimensionOf(unit), `${key}:${unit}`).toBe(dimension)
			expect(preset.units, key).toContain(preset.storageUnit)
			for (const unit of Object.values(preset.localeDefaults))
				expect(preset.units, `${key}:${unit}`).toContain(unit)
		}
	})
	it('keeps the shipped preference buckets, which are saved user data', () => {
		expect(Object.entries(presets).map(([key, preset]) => [key, preset.preferenceKey])).toEqual([
			['bodyWeight', 'bodyWeight'],
			['personHeight', 'personHeight'],
			['distance', 'distance'],
			['mass', 'mass'],
			['length', 'length'],
			['volume', 'volume'],
			['temperature', 'temperature'],
			['speed', 'speed'],
		])
	})
	it('gives personHeight a cm display override so a half-centimetre entry survives readable quantize', () => {
		expect(presets.personHeight.precision).toEqual({ display: { cm: 1 } })
	})
	it('leaves every other preset with no precision override', () => {
		for (const [key, preset] of Object.entries(presets) as [string, MeasurementPreset][]) {
			if (key === 'personHeight') continue
			expect(preset.precision, key).toBeUndefined()
		}
	})
})
