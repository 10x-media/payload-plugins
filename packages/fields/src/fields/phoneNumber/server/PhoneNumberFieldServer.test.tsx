import type { Payload, SanitizedConfig } from 'payload'
import type React from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { FIELDS_REGISTRY_KEY } from '../../../plugin/registry'
import type { PhoneSeed } from '../engine/phone'
import { PHONE_CUSTOM_KEY, type ResolvablePhoneFieldOptions } from '../options'

// The subject is what the server derives and hands over, so the client field is a stub: the real
// one drags @payloadcms/ui and its CSS into a node-environment test.
vi.mock('../client/PhoneNumberField', () => ({ PhoneNumberField: () => null }))

// The happy path keeps the real loader; one case swaps in a rejection to prove the degrade.
vi.mock('../engine/metadata', async (importOriginal) => {
	const actual = await importOriginal<typeof import('../engine/metadata')>()
	return { ...actual, loadMetadata: vi.fn(actual.loadMetadata) }
})

const { loadMetadata } = await import('../engine/metadata')
const { PhoneNumberFieldServer } = await import('./PhoneNumberFieldServer')

const DE_E164 = '+4915112345678'
const DE_SEED: PhoneSeed = {
	callingCode: '49',
	country: 'DE',
	national: '1511 2345678',
	number: DE_E164,
}

const fakePayload = (phoneNumber?: Record<string, unknown>): Payload =>
	({
		config: {
			custom: phoneNumber ? { [FIELDS_REGISTRY_KEY]: { phoneNumber } } : {},
		} as unknown as SanitizedConfig,
		logger: { error: vi.fn(), warn: vi.fn() },
	}) as unknown as Payload

/**
 * `data` always carries a decoy: Payload scopes `data` to the whole document and `siblingData` to
 * the row, and its own `value` prop reads the document. Reading the wrong one picks the decoy up.
 */
const buildProps = (args: {
	data?: unknown
	name?: string
	payload?: Payload
	phoneOptions?: ResolvablePhoneFieldOptions
	siblingData: unknown
	type?: 'group' | 'text'
}) => {
	const name = args.name ?? 'phone'
	const type = args.type ?? 'group'
	return {
		clientField: { name, type },
		data: args.data ?? { [name]: { country: 'US', number: '+12125552368' } },
		field: { custom: {}, name, type },
		path: name,
		phoneOptions: args.phoneOptions ?? {},
		readOnly: false,
		req: { payload: args.payload ?? fakePayload() },
		siblingData: args.siblingData,
		value: { country: 'US', number: '+12125552368' },
		// biome-ignore lint/suspicious/noExplicitAny: fixture supplies only the props the component reads
		...({} as any),
	}
}

/** The seed the component handed to the client field. */
const seedOf = async (
	props: ReturnType<typeof buildProps>
): Promise<null | PhoneSeed | undefined> => {
	const node = (await PhoneNumberFieldServer(props)) as React.ReactElement<{
		seed?: null | PhoneSeed
	}>
	return node.props.seed
}

describe('PhoneNumberFieldServer', () => {
	afterEach(() => {
		vi.mocked(loadMetadata).mockClear()
	})

	it('derives the seed from the group shape', async () => {
		const seed = await seedOf(
			buildProps({ siblingData: { phone: { country: 'DE', number: DE_E164 } } })
		)
		expect(seed).toEqual(DE_SEED)
	})

	it('derives the seed from the e164 shape', async () => {
		const seed = await seedOf(buildProps({ siblingData: { phone: DE_E164 }, type: 'text' }))
		expect(seed).toEqual(DE_SEED)
	})

	// siblingData is scoped to the row, so a nested field reads its own value rather than a
	// same-named one at the document root. Payload's own `value` prop is document-scoped.
	it('reads its own value inside an array row, not the same-named root field', async () => {
		const seed = await seedOf(
			buildProps({ siblingData: { phone: { country: 'CH', number: '+41446681800' } } })
		)
		expect(seed).toEqual({
			callingCode: '41',
			country: 'CH',
			national: '44 668 18 00',
			number: '+41446681800',
		})
	})

	it.each([
		['an empty group', { phone: {} }],
		['an absent field', {}],
		['a null sibling scope', null],
		['an empty string', { phone: '' }],
		['a non-string number', { phone: { number: 42 } }],
	])('returns no seed for %s', async (_label, siblingData) => {
		expect(await seedOf(buildProps({ siblingData }))).toBeNull()
	})

	it('never loads metadata for an empty field', async () => {
		await seedOf(buildProps({ siblingData: {} }))
		expect(loadMetadata).not.toHaveBeenCalled()
	})

	it('resolves the metadata set through the registry', async () => {
		await seedOf(
			buildProps({ payload: fakePayload({ metadata: 'min' }), siblingData: { phone: DE_E164 } })
		)
		expect(loadMetadata).toHaveBeenCalledWith('min')
	})

	// A rejected chunk, or an out-of-union metadata set from unvalidated config, must cost the
	// first frame rather than the whole edit view: there is no error boundary above this.
	it('degrades to no seed when the metadata load rejects', async () => {
		vi.mocked(loadMetadata).mockRejectedValueOnce(new Error('chunk failed'))
		expect(await seedOf(buildProps({ siblingData: { phone: DE_E164 } }))).toBeNull()
	})

	it('degrades to no seed for a metadata set that does not exist', async () => {
		const seed = await seedOf(
			buildProps({
				payload: fakePayload({ metadata: 'nope' }),
				siblingData: { phone: DE_E164 },
			})
		)
		expect(seed).toBeNull()
	})

	it('still throws when the field carries no phone options at all', async () => {
		const props = buildProps({ siblingData: { phone: DE_E164 } })
		await expect(PhoneNumberFieldServer({ ...props, phoneOptions: undefined })).rejects.toThrow(
			PHONE_CUSTOM_KEY
		)
	})
})
