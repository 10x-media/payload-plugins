import type { PayloadRequest, SanitizedConfig, TextField } from 'payload'
import { describe, expect, it } from 'vitest'
import { lucideAdapter } from '../adapters/lucide/adapter'
import { radixAdapter } from '../adapters/radix/adapter'
import { iconLibraryField } from './iconLibraryField'
import { getIconLibraryOptions } from './libraryOptions'

const adapters = [lucideAdapter(), radixAdapter()]
const config = {
	custom: { '@10x-media/fields': { icon: { adapters } } },
} as unknown as SanitizedConfig
const req = { payload: { config }, t: (key: string) => key } as unknown as PayloadRequest

type Validate = (
	value: unknown,
	options: Record<string, unknown>
) => Promise<string | true> | string | true

describe('iconLibraryField', () => {
	it('is a text field with the server select component', () => {
		const field = iconLibraryField()
		expect(field.name).toBe('iconLibrary')
		expect(field.type).toBe('text')
		expect(field.admin?.components?.Field).toMatchObject({
			path: '@10x-media/fields/rsc#IconLibrarySelectServer',
		})
	})

	it('supports hasMany and overrides', () => {
		const field = iconLibraryField({
			hasMany: true,
			overrides: ({ field: base }): TextField => ({ ...base, index: true }),
		})
		expect(field.hasMany).toBe(true)
		expect(field.index).toBe(true)
	})

	it('validates values against the registry', async () => {
		const field = iconLibraryField()
		const validate = field.validate as Validate
		expect(await validate('lucide', { req })).toBe(true)
		expect(await validate(['lucide', 'radix'], { req })).toBe(true)
		expect(await validate('tabler', { req })).toContain('fields:invalidIconLibraryValue')
		expect(await validate(null, { req })).toBe(true)
	})

	it('rejects non-string entries', async () => {
		const validate = iconLibraryField().validate as Validate
		expect(await validate(['lucide', 7], { req })).toContain('fields:invalidIconLibraryValue')
	})

	it('enforces required, including a required flag added through overrides', async () => {
		const validate = iconLibraryField({ required: true }).validate as Validate
		expect(await validate(null, { req })).toContain('validation:required')
		const overridden = iconLibraryField({
			overrides: ({ field: base }): TextField => ({ ...base, required: true }),
		}).validate as Validate
		expect(await overridden(null, { req, required: true })).toContain('validation:required')
	})

	it('validates against inline adapters when given', async () => {
		const validate = iconLibraryField({ adapters: [lucideAdapter()] }).validate as Validate
		const bareReq = { payload: { config: { custom: {} } }, t: req.t } as unknown as PayloadRequest
		expect(await validate('lucide', { req: bareReq })).toBe(true)
		expect(await validate('radix', { req: bareReq })).toContain('fields:invalidIconLibraryValue')
	})

	it('derives options from the registry', () => {
		expect(getIconLibraryOptions(config).map((option) => option.value)).toEqual(['lucide', 'radix'])
	})
})
