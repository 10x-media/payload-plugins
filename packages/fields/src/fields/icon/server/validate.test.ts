import type { PayloadRequest, TextFieldValidation } from 'payload'
import { describe, expect, it } from 'vitest'
import type { IconAdapter } from '../../../types'
import { createIconValidate } from './validate'

const fakeAdapter = (slug: string, names: string[]): IconAdapter => ({
	slug,
	label: slug,
	loadManifest: () =>
		Promise.resolve({
			categories: [],
			icons: names.map((name) => ({ categories: [], name, tags: [] })),
		}),
	Icon: `x#${slug}Icon`,
	Assets: `x#${slug}Assets`,
	version: 1,
})

const req = {
	payload: { config: { custom: {} } },
	t: (key: string, vars?: Record<string, unknown>) => `${key}:${JSON.stringify(vars ?? {})}`,
} as unknown as PayloadRequest

type ValidateOptions = Parameters<TextFieldValidation>[1]

const options = (extra: Record<string, unknown> = {}): ValidateOptions =>
	({ req, ...extra }) as unknown as ValidateOptions

const adapters = [fakeAdapter('lucide', ['house', 'heart']), fakeAdapter('radix', ['cube'])]

describe('createIconValidate', () => {
	const validate = createIconValidate({ adapters, defaultLibrary: 'lucide', required: false })

	it('accepts empty when not required, rejects when required', async () => {
		expect(await validate(null, options())).toBe(true)
		const requiredValidate = createIconValidate({
			adapters,
			defaultLibrary: 'lucide',
			required: true,
		})
		expect(await requiredValidate('', options())).toContain('validation:required')
	})

	it('honors a required flag added to the field after the factory ran', async () => {
		expect(await validate('', options({ required: true }))).toContain('validation:required')
	})

	it('accepts a valid prefixed value', async () => {
		expect(await validate('lucide:house', options())).toBe(true)
		expect(await validate('radix:cube', options())).toBe(true)
	})

	it('accepts bare legacy values against the default library', async () => {
		expect(await validate('house', options())).toBe(true)
	})

	it('rejects an unregistered library, even unchanged', async () => {
		const result = await validate('bogus:house', options({ previousValue: 'bogus:house' }))
		expect(result).toContain('fields:invalidIconLibrary')
	})

	it('rejects an unknown name on new input', async () => {
		expect(await validate('lucide:nope', options())).toContain('fields:invalidIconName')
		expect(await validate('nope', options())).toContain('fields:invalidIconName')
	})

	it('accepts an unknown name when the value is unchanged (stored data survives upgrades)', async () => {
		expect(await validate('lucide:nope', options({ previousValue: 'lucide:nope' }))).toBe(true)
	})

	it('falls back to the registry when the field carries no inline adapters', async () => {
		const registryValidate = createIconValidate({ required: false })
		const registryReq = {
			payload: {
				config: {
					custom: { '@10x-media/fields': { icon: { adapters, defaultLibrary: 'radix' } } },
				},
			},
			t: req.t,
		} as unknown as PayloadRequest
		const registryOptions = { req: registryReq } as unknown as ValidateOptions
		expect(await registryValidate('cube', registryOptions)).toBe(true)
		expect(await registryValidate('house', registryOptions)).toContain('fields:invalidIconName')
	})
})
