import { describe, expect, it } from 'vitest'
import { emailField } from './email'

const t = (key: string) => key
const base = { config: {}, siblingData: {}, data: {}, locale: 'en', t }

describe('emailField', () => {
	it('accepts a valid email', () => {
		expect(emailField.validate?.({ value: 'a@b.com', ...base })).toBe(true)
	})
	it('rejects an invalid email with the i18n key', () => {
		expect(emailField.validate?.({ value: 'nope', ...base })).toBe('formBuilder:validation.email')
	})
	it('treats empty as valid (required handles emptiness)', () => {
		expect(emailField.validate?.({ value: '', ...base })).toBe(true)
	})
	it('formats as the raw string', () => {
		expect(emailField.format?.({ value: 'a@b.com', config: {}, locale: 'en', t })).toBe('a@b.com')
	})
})
