import type { TextField } from 'payload'
import { describe, expect, it } from 'vitest'
import { iconField } from './iconField'

describe('iconField', () => {
	it('returns a text field with server Field/Cell components', () => {
		const field = iconField()
		expect(field.name).toBe('icon')
		expect(field.type).toBe('text')
		expect(field.admin?.components?.Field).toMatchObject({
			path: '@10x-media/fields/rsc#IconFieldServer',
		})
		expect(field.admin?.components?.Cell).toMatchObject({ path: '@10x-media/fields/rsc#IconCell' })
		expect(typeof field.validate).toBe('function')
	})

	it('passes options through', () => {
		const field = iconField({
			defaultLibrary: 'radix',
			localized: true,
			name: 'symbol',
			required: true,
			showTextInput: true,
		})
		expect(field.name).toBe('symbol')
		expect(field.localized).toBe(true)
		expect(field.required).toBe(true)
		const fieldComponent = field.admin?.components?.Field as {
			serverProps: Record<string, unknown>
		}
		expect(fieldComponent.serverProps).toMatchObject({
			defaultLibrary: 'radix',
			showTextInput: true,
		})
	})

	it('applies function-form overrides', () => {
		const field = iconField({
			overrides: ({ field: base }): TextField => ({ ...base, index: true }),
		})
		expect(field.index).toBe(true)
		expect(field.type).toBe('text')
	})
})
