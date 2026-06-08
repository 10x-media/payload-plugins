import { describe, expect, it } from 'vitest'
import { textField } from './text'
import { textareaField } from './textarea'

const t = (key: string) => key

describe('text and textarea fields', () => {
	it('format as the raw string', () => {
		expect(textField.format?.({ value: 'hi', config: {}, locale: 'en', t })).toBe('hi')
		expect(textareaField.format?.({ value: 'hi', config: {}, locale: 'en', t })).toBe('hi')
	})
	it('format null as empty', () => {
		expect(textField.format?.({ value: null, config: {}, locale: 'en', t })).toBe('')
	})
})
