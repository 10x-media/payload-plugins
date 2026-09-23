import type { NamedGroupField, TextField } from 'payload'
import { describe, expect, it } from 'vitest'
import { FIELDS_REGISTRY_KEY } from '../../plugin/registry'
import type { MetadataSet } from './engine/metadata'
import type { CountryCode } from './engine/phone'
import { phoneNumberField } from './phoneNumberField'

// phoneNumberField's group branch always receives a `name`, so the result is always a
// NamedGroupField; that (rather than the wider GroupField union) is what lets `.name` and
// `.hooks` be read below without narrowing against the unnamed variant first.
const group = (opts: Parameters<typeof phoneNumberField>[0]) =>
	phoneNumberField(opts) as NamedGroupField

/** A minimal `t` stub: validators only interpolate the key, never look up a bundle. */
const t = (key: string) => key

/** A request stub carrying `t` (for validate) and `payload.config` (for the registry). */
const reqWithRegistry = (custom?: Record<string, unknown>) =>
	({ payload: { config: { custom } }, t }) as never

const validateArgs = { req: reqWithRegistry() } as never

/** Validate args backed by a registry configured with the given phoneNumber layer. */
const argsWithPhoneRegistry = (phoneNumber: Record<string, unknown>) =>
	({ req: reqWithRegistry({ [FIELDS_REGISTRY_KEY]: { phoneNumber } }) }) as never

const argsWithMetadata = (metadata: MetadataSet) => argsWithPhoneRegistry({ metadata })

/** Reads `admin.components.<Field|Cell>.clientProps.phoneOptions`, the wire contract the field and cell components build on. */
const phoneOptionsOf = (
	field: { admin?: { components?: { Cell?: unknown; Field?: unknown } } },
	component: 'Cell' | 'Field'
): unknown => {
	const entry = field.admin?.components?.[component]
	if (!entry || typeof entry !== 'object' || !('clientProps' in entry)) return undefined
	return (entry as { clientProps?: { phoneOptions?: unknown } }).clientProps?.phoneOptions
}

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

	it("stamps the field's own options unresolved under the custom key, for hand-authored configs", () => {
		// Exact equality, not toMatchObject: proves no default (storage, validation, ...) got
		// baked in alongside the one option actually set.
		expect(group({ flags: 'emoji', name: 'phone' }).custom?.['@10x-media/fields']).toEqual({
			flags: 'emoji',
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

// Nothing above reads clientProps, so deleting it left every other test green anyway. This
// is the field/cell render contract, so it gets its own direct coverage on both storage shapes.
describe('phoneNumberField clientProps.phoneOptions contract', () => {
	const authored = {
		countries: ['DE', 'FR'] as const,
		defaultCountry: 'DE' as const,
		isClearable: false,
		preferredCountries: ['DE'] as const,
	}

	it('threads field options into Field and Cell clientProps.phoneOptions, group storage', () => {
		const field = group({ ...authored, name: 'phone' })
		expect(phoneOptionsOf(field, 'Field')).toMatchObject(authored)
		expect(phoneOptionsOf(field, 'Cell')).toMatchObject(authored)
	})

	it('threads field options into Field and Cell clientProps.phoneOptions, e164 storage', () => {
		const field = phoneNumberField({ ...authored, name: 'phone', storage: 'e164' }) as TextField
		expect(phoneOptionsOf(field, 'Field')).toMatchObject(authored)
		expect(phoneOptionsOf(field, 'Cell')).toMatchObject(authored)
	})

	it('never resolves a default into the bag, so a registry default can still win downstream', () => {
		const phoneOptions = phoneOptionsOf(group({ name: 'phone' }), 'Field') as Record<
			string,
			unknown
		>
		expect(phoneOptions).not.toHaveProperty('flags')
		expect(phoneOptions).not.toHaveProperty('validation')
		expect(phoneOptions).not.toHaveProperty('metadata')
		expect(phoneOptions).not.toHaveProperty('storage')
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
		expect(await field.validate?.({}, validateArgs)).toBe('fields:phoneRequired')
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
		expect(result).toBe('fields:invalidPhoneNumber')
	})

	it('accepts a valid stored number', async () => {
		const field = group({ name: 'phone' })
		const result = await field.validate?.({ country: 'DE', number: '+4915112345678' }, validateArgs)
		expect(result).toBe(true)
	})

	it('rejects a valid landline when validation is mobile-only', async () => {
		const field = group({ name: 'phone', validation: 'mobile' })
		const result = await field.validate?.({ country: 'DE', number: '+49301234567' }, validateArgs)
		expect(result).toBe('fields:phoneNotMobile')
	})

	it('resolves the metadata set from the registry, not a build-time default', async () => {
		const field = group({ name: 'phone' })
		const value = { country: 'DE', number: '+4915112345' }
		// 'max' and 'min' genuinely disagree on this number's validity. If validate ever
		// hardcodes a metadata set again, one side of this pair silently starts failing.
		const underMin = await field.validate?.(value, argsWithMetadata('min'))
		const underMax = await field.validate?.(value, validateArgs)
		expect(underMin).toBe(true)
		expect(underMax).toBe('fields:invalidPhoneNumber')
	})

	it("honours a plugin-level validation default, not just the field's own", async () => {
		const field = group({ name: 'phone' })
		const mobileOnly = argsWithPhoneRegistry({ validation: 'mobile' })
		// A genuine landline: only rejected as not-mobile if the registry's validation
		// default actually reached the validator, since the field itself never set it.
		const result = await field.validate?.({ country: 'DE', number: '+49301234567' }, mobileOnly)
		expect(result).toBe('fields:phoneNotMobile')
	})

	it('reports a configuration error, not a false rejection, when mobile-only meets metadata min', async () => {
		const field = group({ name: 'phone', validation: 'mobile' })
		// A genuinely valid mobile number: 'min' metadata just can't detect its type.
		const result = await field.validate?.(
			{ country: 'DE', number: '+4915112345678' },
			argsWithMetadata('min')
		)
		expect(result).toBe(
			'phoneNumberField(phone): validation "mobile" requires metadata "max" or "mobile", but this install is configured "min"'
		)
	})
})

describe('phoneNumberField, e164 storage validate behaviour', () => {
	it('rejects a malformed number', async () => {
		const field = phoneNumberField({ name: 'phone', storage: 'e164' }) as TextField
		expect(await field.validate?.('not a phone number' as never, validateArgs)).toBe(
			'fields:invalidPhoneNumber'
		)
	})

	it('accepts a valid e164 number', async () => {
		const field = phoneNumberField({ name: 'phone', storage: 'e164' }) as TextField
		expect(await field.validate?.('+4915112345678' as never, validateArgs)).toBe(true)
	})

	it('resolves the metadata set from the registry, not a build-time default', async () => {
		const field = phoneNumberField({ name: 'phone', storage: 'e164' }) as TextField
		const underMin = await field.validate?.('+4915112345' as never, argsWithMetadata('min'))
		const underMax = await field.validate?.('+4915112345' as never, validateArgs)
		expect(underMin).toBe(true)
		expect(underMax).toBe('fields:invalidPhoneNumber')
	})

	it("honours a plugin-level defaultCountry, not just the field's own", async () => {
		const field = phoneNumberField({ name: 'phone', storage: 'e164' }) as TextField
		const args = argsWithPhoneRegistry({ defaultCountry: 'DE' })
		// National-format, no country code of its own: unparseable without a defaultCountry
		// from somewhere, and the field itself never set one.
		const result = await field.validate?.('0151 12345678' as never, args)
		expect(result).toBe(true)
	})

	it('reports a configuration error, not a false rejection, when mobile-only meets metadata min', async () => {
		const field = phoneNumberField({
			name: 'phone',
			storage: 'e164',
			validation: 'mobile',
		}) as TextField
		const result = await field.validate?.('+4915112345678' as never, argsWithMetadata('min'))
		expect(result).toBe(
			'phoneNumberField(phone): validation "mobile" requires metadata "max" or "mobile", but this install is configured "min"'
		)
	})
})

describe('phoneNumberField derived read hook', () => {
	it('installs exactly one afterRead hook, not one per derived subfield', () => {
		expect(group({ name: 'phone' }).hooks?.afterRead).toHaveLength(1)
	})

	it('enriches a stored number without clobbering number or country', async () => {
		const field = group({ name: 'phone' })
		const hook = field.hooks?.afterRead?.[0]
		// Stored in national format on purpose: its parsed e164 ('+4915112345678') differs
		// from the stored string, so a hook that clobbered `number` with the parsed form
		// (instead of spreading the stored value first) would fail this assertion.
		const result = (await hook?.({
			req: reqWithRegistry(),
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
		expect(await hook?.({ req: reqWithRegistry(), value } as never)).toBe(value)
	})

	it('reads the registry metadata set at request time, not the factory default', async () => {
		const field = group({ name: 'phone' })
		const hook = field.hooks?.afterRead?.[0]
		const req = reqWithRegistry({
			[FIELDS_REGISTRY_KEY]: { phoneNumber: { metadata: 'min' } },
		})
		// 'min' metadata carries no per-type patterns, so `type` is honestly undefined here,
		// while every other derived field still resolves the same as under 'max'.
		const result = (await hook?.({
			req,
			value: { country: 'DE', number: '0151 12345678' },
		} as never)) as Record<string, unknown>
		expect(result.type).toBeUndefined()
		expect(result.national).toBe('01511 2345678')
		expect(result.callingCode).toBe('49')
	})

	it('degrades to the default metadata set when the registry value is missing', async () => {
		const field = group({ name: 'phone' })
		const hook = field.hooks?.afterRead?.[0]
		const result = (await hook?.({
			req: reqWithRegistry(),
			value: { country: 'DE', number: '0151 12345678' },
		} as never)) as Record<string, unknown>
		// No registry entry at all resolves to DEFAULT_METADATA_SET ('max'), which is the
		// only set carrying number-type patterns, so `type` comes back populated.
		expect(result.type).toBe('MOBILE')
	})
})
