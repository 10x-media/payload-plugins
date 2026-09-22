import type { NamedGroupField, TextField } from 'payload'
import { describe, expect, it } from 'vitest'
import type { CountryCode } from './engine/phone'
import { phoneNumberField } from './phoneNumberField'

// phoneNumberField's group branch always receives a `name`, so the result is always a
// NamedGroupField; that (rather than the wider GroupField union) is what lets `.name` and
// `.hooks` be read below without narrowing against the unnamed variant first.
const group = (opts: Parameters<typeof phoneNumberField>[0]) =>
	phoneNumberField(opts) as NamedGroupField

/** A minimal `t` stub: validators only interpolate the key, never look up a bundle. */
const t = (key: string) => key
const validateArgs = { req: { t } } as never

describe('phoneNumberField, object storage', () => {
	it('returns a group named after the field', () => {
		const field = group({ name: 'phone' })
		expect(field.type).toBe('group')
		expect(field.name).toBe('phone')
	})

	it('persists exactly number and country', () => {
		const persisted = group({ name: 'phone' }).fields.filter((f) => !('virtual' in f && f.virtual))
		expect(persisted.map((f) => 'name' in f && f.name)).toEqual(['number', 'country'])
	})

	it('marks every derived subfield virtual so it takes no column', () => {
		const virtuals = group({ name: 'phone' })
			.fields.filter((f) => 'virtual' in f && f.virtual)
			.map((f) => ('name' in f ? f.name : ''))
		expect(virtuals).toEqual(['national', 'international', 'callingCode', 'uri', 'type'])
	})

	it('keeps subfields out of the list so the group is one column', () => {
		for (const sub of group({ name: 'phone' }).fields) {
			expect(sub.admin?.disableListColumn).toBe(true)
		}
	})

	it('points Field and Cell at importMap string paths, never imported components', () => {
		const components = group({ name: 'phone' }).admin?.components
		expect(components?.Field).toMatchObject({
			path: '@10x-media/fields/rsc#PhoneNumberFieldServer',
		})
		expect(components?.Cell).toMatchObject({ path: '@10x-media/fields/rsc#PhoneNumberCellServer' })
	})

	it('stamps resolved options under the custom key for hand-authored configs', () => {
		expect(group({ name: 'phone' }).custom?.['@10x-media/fields']).toMatchObject({
			flags: 'svg',
			storage: 'object',
		})
	})

	it('supplies its own validate, because required on a group is a Payload no-op', () => {
		expect(typeof group({ name: 'phone', required: true }).validate).toBe('function')
	})

	it('applies overrides by spread and returns the override result verbatim', () => {
		const field = group({
			name: 'phone',
			overrides: ({ field: f }) => ({ ...f, admin: { ...f.admin, width: '50%' } }),
		})
		expect(field.admin?.width).toBe('50%')
	})
})

describe('phoneNumberField, e164 storage', () => {
	it('returns a plain text field at the field name', () => {
		const field = phoneNumberField({ name: 'phone', storage: 'e164' }) as TextField
		expect(field.type).toBe('text')
		expect(field.name).toBe('phone')
	})

	it('has no subfields and therefore no country column', () => {
		expect('fields' in phoneNumberField({ name: 'phone', storage: 'e164' })).toBe(false)
	})
})

describe('phoneNumberField validation guards', () => {
	it('rejects an unsupported country in the allowlist at build time', () => {
		expect(() => group({ countries: ['DE', 'ZZ' as CountryCode], name: 'phone' })).toThrow(/ZZ/)
	})

	it('rejects a defaultCountry outside the allowlist at build time', () => {
		expect(() => group({ countries: ['DE'], defaultCountry: 'FR', name: 'phone' })).toThrow(
			/defaultCountry/
		)
	})

	it('names the field in its error messages', () => {
		expect(() => group({ countries: ['ZZ' as CountryCode], name: 'homePhone' })).toThrow(
			/homePhone/
		)
	})
})

// The suites above only check the shape of the returned config. Validate and the
// derived-read hook are where mechanics 2 and 3 actually live, so exercise them directly.
describe('phoneNumberField, object storage validate behaviour', () => {
	it('rejects an empty stored group when required, by inspecting number, not the object', async () => {
		const field = group({ name: 'phone', required: true })
		expect(await field.validate?.({}, validateArgs)).not.toBe(true)
	})

	it('accepts an empty stored group when not required', async () => {
		const field = group({ name: 'phone' })
		expect(await field.validate?.({}, validateArgs)).toBe(true)
	})

	it('rejects a malformed number', async () => {
		const field = group({ name: 'phone' })
		const result = await field.validate?.(
			{ country: 'DE', number: 'not a phone number' },
			validateArgs
		)
		expect(result).not.toBe(true)
	})

	it('accepts a valid stored number', async () => {
		const field = group({ name: 'phone' })
		const result = await field.validate?.({ country: 'DE', number: '+4915112345678' }, validateArgs)
		expect(result).toBe(true)
	})

	it('rejects a valid landline when validation is mobile-only', async () => {
		const field = group({ name: 'phone', validation: 'mobile' })
		const result = await field.validate?.({ country: 'DE', number: '+49301234567' }, validateArgs)
		expect(result).not.toBe(true)
	})
})

describe('phoneNumberField, e164 storage validate behaviour', () => {
	it('rejects a malformed number', async () => {
		const field = phoneNumberField({ name: 'phone', storage: 'e164' }) as TextField
		expect(await field.validate?.('not a phone number' as never, validateArgs)).not.toBe(true)
	})

	it('accepts a valid e164 number', async () => {
		const field = phoneNumberField({ name: 'phone', storage: 'e164' }) as TextField
		expect(await field.validate?.('+4915112345678' as never, validateArgs)).toBe(true)
	})
})

describe('phoneNumberField derived read hook', () => {
	it('enriches a stored number without clobbering number or country', async () => {
		const field = group({ name: 'phone' })
		const hook = field.hooks?.afterRead?.[0]
		// Stored in national format on purpose: its parsed e164 ('+4915112345678') differs
		// from the stored string, so a hook that clobbered `number` with the parsed form
		// (instead of spreading the stored value first) would fail this assertion.
		const result = (await hook?.({
			value: { country: 'DE', number: '0151 12345678' },
		} as never)) as Record<string, unknown>
		expect(result).toMatchObject({ country: 'DE', number: '0151 12345678' })
		expect(result.national).toBe('01511 2345678')
		expect(result.international).toBe('+49 1511 2345678')
		expect(result.callingCode).toBe('49')
		expect(result.uri).toBe('tel:+4915112345678')
		expect(result.type).toBe('MOBILE')
	})

	it('returns the stored value unchanged when there is no number to parse', async () => {
		const field = group({ name: 'phone' })
		const hook = field.hooks?.afterRead?.[0]
		const value = { country: 'DE' }
		expect(await hook?.({ value } as never)).toBe(value)
	})
})
