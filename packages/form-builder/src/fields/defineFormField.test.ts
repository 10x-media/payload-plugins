import { describe, expect, it } from 'vitest'
import { defineFormField } from './defineFormField'

const t = (key: string) => key

describe('defineFormField', () => {
	it('returns the definition unchanged', () => {
		const def = defineFormField<'number'>({
			type: 'rating',
			label: 'Rating',
			value: 'number',
			validate: ({ value }) => (value == null || value <= 5 ? true : 'Too high'),
			format: ({ value }) => `${value ?? 0} / 5`,
		})
		expect(def.type).toBe('rating')
		expect(def.value).toBe('number')
	})

	it('threads the typed value into validate and format', () => {
		const def = defineFormField<'number'>({
			type: 'n',
			label: 'N',
			value: 'number',
			validate: ({ value }) => (value == null ? true : value > 0 ? true : 'positive'),
			format: ({ value }) => String(value ?? ''),
		})
		expect(
			def.validate?.({ value: 3, config: {}, siblingData: {}, data: {}, locale: 'en', t })
		).toBe(true)
		expect(
			def.validate?.({ value: -1, config: {}, siblingData: {}, data: {}, locale: 'en', t })
		).toBe('positive')
		expect(def.format?.({ value: 3, config: {}, locale: 'en', t })).toBe('3')
	})
})
