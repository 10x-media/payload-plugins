import { describe, expect, it } from 'vitest'
import { toSelectOption } from '../fields/config/toSelectOption'
import { pickLabel } from './labelMap'

const map = { de: 'Besucher', en: 'Visitors', fr: '' }

describe('pickLabel', () => {
	it("reads the reader's language first", () => {
		expect(pickLabel(map, 'de', 'en')).toBe('Besucher')
	})

	it("falls back to the install's fallback language, then English", () => {
		expect(pickLabel(map, 'ja', 'de')).toBe('Besucher')
		expect(pickLabel(map, 'ja', ['nl', 'de'])).toBe('Besucher')
		expect(pickLabel(map, 'ja', 'nl')).toBe('Visitors')
		expect(pickLabel(map, 'ja')).toBe('Visitors')
	})

	it('passes over a blank entry and answers nothing when no entry is usable', () => {
		expect(pickLabel(map, 'fr', 'de')).toBe('Besucher')
		expect(pickLabel({ fr: ' ' }, 'fr', 'de')).toBeUndefined()
		expect(pickLabel(undefined, 'de')).toBeUndefined()
	})
})

describe('toSelectOption', () => {
	it('labels a map option in the fallback language before English, then by its value', () => {
		const option = { label: { de: 'Besucher', en: 'Visitors' }, value: 'visitors' }
		expect(toSelectOption(option, 'ja', 'de')).toEqual({ label: 'Besucher', value: 'visitors' })
		expect(toSelectOption(option, 'ja')).toEqual({ label: 'Visitors', value: 'visitors' })
		expect(toSelectOption({ label: {}, value: 'visitors' }, 'ja')).toEqual({
			label: 'visitors',
			value: 'visitors',
		})
	})
})
