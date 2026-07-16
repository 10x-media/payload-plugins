import { describe, expect, it } from 'vitest'
import { buildConsentField, consentField } from './consent'

const t = (key: string) => key
const base = { siblingData: {}, data: {}, locale: 'en', t }

describe('consentField', () => {
	it('has type "consent"', () => {
		expect(consentField.type).toBe('consent')
	})

	it('has value kind "boolean"', () => {
		expect(consentField.value).toBe('boolean')
	})

	it('statement is a richText field with an admin description, no editor key', () => {
		const config = consentField.config ?? []
		const statement = config.find((f) => 'name' in f && f.name === 'statement') as
			| { type?: string; admin?: { description?: unknown }; editor?: unknown }
			| undefined
		expect(statement).toBeDefined()
		expect(statement?.type).toBe('richText')
		expect(statement?.admin?.description).toBeDefined()
		expect('editor' in (statement ?? {})).toBe(false)
	})

	it('statement is localized when localize is true, not when false', () => {
		const localized = (buildConsentField(true).config ?? []).find(
			(f) => 'name' in f && f.name === 'statement'
		) as { localized?: boolean }
		const plain = (buildConsentField(false).config ?? []).find(
			(f) => 'name' in f && f.name === 'statement'
		) as { localized?: boolean }
		expect(localized.localized).toBe(true)
		expect('localized' in plain).toBe(false)
	})

	it('validates: required (default) + value not true -> error', () => {
		const result = consentField.validate?.({ ...base, value: false, config: {} })
		expect(result).toBe('formBuilder:validation.required')
	})

	it('validates: required (default) + value undefined -> error', () => {
		const result = consentField.validate?.({ ...base, value: undefined, config: {} })
		expect(result).toBe('formBuilder:validation.required')
	})

	it('validates: required (default) + value true -> valid', () => {
		const result = consentField.validate?.({ ...base, value: true, config: {} })
		expect(result).toBe(true)
	})

	it('validates: optional=true + value false -> valid (marketing-style opt-in)', () => {
		const result = consentField.validate?.({ ...base, value: false, config: { optional: true } })
		expect(result).toBe(true)
	})

	it('validates: optional=false (explicit) + value false -> error', () => {
		const result = consentField.validate?.({ ...base, value: false, config: { optional: false } })
		expect(result).toBe('formBuilder:validation.required')
	})

	it('formats true as Yes key', () => {
		expect(consentField.format?.({ value: true, config: {}, locale: 'en', t })).toBe(
			'formBuilder:format.yes'
		)
	})

	it('formats false as No key', () => {
		expect(consentField.format?.({ value: false, config: {}, locale: 'en', t })).toBe(
			'formBuilder:format.no'
		)
	})
})
