import { describe, expect, it } from 'vitest'
import { consentField } from './consent'

const t = (key: string) => key
const base = { siblingData: {}, data: {}, locale: 'en', t }

describe('consentField', () => {
	it('has type "consent"', () => {
		expect(consentField.type).toBe('consent')
	})

	it('has value kind "boolean"', () => {
		expect(consentField.value).toBe('boolean')
	})

	it('is configured by a source reference and a display, nothing else', () => {
		expect((consentField.config ?? []).map((f) => ('name' in f ? f.name : f.type))).toEqual([
			'source',
			'display',
		])
	})

	it('drops the shared label, placeholder, and description, since the statement is the visible text', () => {
		expect(consentField.omitShared).toEqual(['label', 'placeholder', 'description'])
	})

	it('renders the source through the consent-sources endpoint select', () => {
		const source = (consentField.config ?? []).find((f) => 'name' in f && f.name === 'source') as {
			type?: string
			admin?: { components?: { Field?: { path?: string; clientProps?: Record<string, unknown> } } }
		}
		expect(source.type).toBe('text')
		const component = source.admin?.components?.Field
		expect(component?.path).toBe('@10x-media/form-builder/client#EndpointOptionsSelect')
		expect(component?.clientProps).toMatchObject({
			endpoint: 'consent-sources',
			isClearable: false,
		})
		expect(component?.clientProps?.descriptionKey).toBeDefined()
	})

	it('validates: required + value not true -> error', () => {
		expect(consentField.validate?.({ ...base, value: false, config: { required: true } })).toBe(
			'formBuilder:validation.required'
		)
	})

	it('validates: required + value undefined -> error', () => {
		expect(consentField.validate?.({ ...base, value: undefined, config: { required: true } })).toBe(
			'formBuilder:validation.required'
		)
	})

	it('validates: required + value true -> valid', () => {
		expect(consentField.validate?.({ ...base, value: true, config: { required: true } })).toBe(true)
	})

	it('validates: a notice display always passes, since the submit itself is the consent', () => {
		expect(
			consentField.validate?.({
				...base,
				value: undefined,
				config: { required: true, display: 'notice' },
			})
		).toBe(true)
		expect(
			consentField.validate?.({
				...base,
				value: false,
				config: { required: true, display: 'notice' },
			})
		).toBe(true)
	})

	it('offers a display select defaulting to checkbox', () => {
		const display = consentField.config?.find(
			(entry) => 'name' in entry && entry.name === 'display'
		) as { type?: string; defaultValue?: unknown } | undefined
		expect(display?.type).toBe('select')
		expect(display?.defaultValue).toBe('checkbox')
	})

	it('validates: not required + value false -> valid (marketing-style opt-in)', () => {
		expect(consentField.validate?.({ ...base, value: false, config: {} })).toBe(true)
		expect(consentField.validate?.({ ...base, value: false, config: { required: false } })).toBe(
			true
		)
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
