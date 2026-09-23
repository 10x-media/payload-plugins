// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import type { Payload, SanitizedConfig } from 'payload'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { FIELDS_REGISTRY_KEY } from '../../../plugin/registry'
import { PHONE_CUSTOM_KEY, type ResolvablePhoneFieldOptions } from '../options'

// The happy path keeps the real loader; one case swaps in a rejection to prove the degrade.
vi.mock('../engine/metadata', async (importOriginal) => {
	const actual = await importOriginal<typeof import('../engine/metadata')>()
	return { ...actual, loadMetadata: vi.fn(actual.loadMetadata) }
})

const { loadMetadata } = await import('../engine/metadata')
const { PhoneNumberCellServer } = await import('./PhoneNumberCellServer')

const DE_E164 = '+4915112345678'

type CellDataFixture = { country?: string; number?: string } | null | string | undefined

const fakePayload = (registryPhoneNumber?: Record<string, unknown>): Payload => {
	const config = {
		custom: registryPhoneNumber
			? { [FIELDS_REGISTRY_KEY]: { phoneNumber: registryPhoneNumber } }
			: {},
		routes: { api: '/api' },
		serverURL: 'https://cms.example.com',
	} as unknown as SanitizedConfig
	return { config, logger: { error: vi.fn() } } as unknown as Payload
}

const buildProps = (args: {
	cellData: CellDataFixture
	custom?: Record<string, unknown>
	payload?: Payload
	phoneOptions?: ResolvablePhoneFieldOptions
}) => ({
	cellData: args.cellData,
	field: { custom: args.custom, name: 'phone', type: 'group' },
	payload: args.payload ?? fakePayload(),
	phoneOptions: args.phoneOptions,
	// biome-ignore lint/suspicious/noExplicitAny: fixture only supplies the DefaultServerCellComponentProps fields the component reads
	...({} as any),
})

describe('PhoneNumberCellServer', () => {
	afterEach(() => {
		cleanup()
		vi.mocked(loadMetadata).mockClear()
	})

	it.each([
		['e164', DE_E164],
		['national', '01511 2345678'],
		['international', '+49 1511 2345678'],
	] as const)('formats a parseable number as %s', async (cellFormat, expected) => {
		const node = await PhoneNumberCellServer(
			buildProps({ cellData: DE_E164, phoneOptions: { cellFormat, flags: 'none' } })
		)
		render(node)
		expect(screen.getByText(expected)).toBeDefined()
	})

	it('renders an svg flag pointed at the app flags endpoint', async () => {
		const node = await PhoneNumberCellServer(
			buildProps({
				cellData: { country: 'DE', number: DE_E164 },
				phoneOptions: { cellFormat: 'e164', flags: 'svg' },
			})
		)
		const { container } = render(node)
		const image = container.querySelector('img')
		expect(image?.getAttribute('src')).toBe('https://cms.example.com/api/10x-fields/flags/de.svg')
	})

	it('renders an emoji flag and requests no artwork', async () => {
		const node = await PhoneNumberCellServer(
			buildProps({ cellData: DE_E164, phoneOptions: { cellFormat: 'e164', flags: 'emoji' } })
		)
		const { container } = render(node)
		expect(container.querySelector('img')).toBeNull()
		expect(container.textContent).toContain(String.fromCodePoint(0x1f1e9, 0x1f1ea))
	})

	it('renders no flag at all in none mode, even with a known country', async () => {
		const node = await PhoneNumberCellServer(
			buildProps({
				cellData: { country: 'DE', number: DE_E164 },
				phoneOptions: { cellFormat: 'e164', flags: 'none' },
			})
		)
		const { container } = render(node)
		expect(container.querySelector('img')).toBeNull()
		expect(container.textContent).not.toContain(String.fromCodePoint(0x1f1e9, 0x1f1ea))
	})

	it('renders nothing for an empty string value', async () => {
		const node = await PhoneNumberCellServer(
			buildProps({ cellData: '', phoneOptions: { cellFormat: 'e164', flags: 'svg' } })
		)
		expect(node).toBeNull()
	})

	it('renders nothing for an empty object-storage value', async () => {
		const node = await PhoneNumberCellServer(
			buildProps({ cellData: { number: '' }, phoneOptions: { cellFormat: 'e164', flags: 'svg' } })
		)
		expect(node).toBeNull()
	})

	it('renders the raw stored value unchanged when it cannot be parsed', async () => {
		const node = await PhoneNumberCellServer(
			buildProps({
				cellData: 'not-a-phone-number',
				phoneOptions: { cellFormat: 'national', flags: 'svg' },
			})
		)
		render(node)
		expect(screen.getByText('not-a-phone-number')).toBeDefined()
	})

	// A rejected chunk must cost this one cell, not the list page: there is no error boundary above it.
	it('degrades to the raw value and logs when the metadata load rejects', async () => {
		vi.mocked(loadMetadata).mockRejectedValueOnce(new Error('chunk failed'))
		const payload = fakePayload()
		const node = await PhoneNumberCellServer(
			buildProps({
				cellData: DE_E164,
				payload,
				phoneOptions: { cellFormat: 'national', flags: 'none' },
			})
		)
		render(node)
		expect(screen.getByText(DE_E164)).toBeDefined()
		expect(payload.logger.error).toHaveBeenCalledWith(
			{ err: expect.any(Error) },
			'[fields] phoneNumber metadata failed to load for a list cell'
		)
	})

	it('degrades to the raw value for a metadata set that does not exist', async () => {
		const node = await PhoneNumberCellServer(
			buildProps({
				cellData: DE_E164,
				payload: fakePayload({ metadata: 'nope' }),
				phoneOptions: { cellFormat: 'national', flags: 'none' },
			})
		)
		render(node)
		expect(screen.getByText(DE_E164)).toBeDefined()
	})

	it('still flags the stored country when the number itself fails to parse', async () => {
		const node = await PhoneNumberCellServer(
			buildProps({
				cellData: { country: 'DE', number: 'not-a-phone-number' },
				phoneOptions: { cellFormat: 'national', flags: 'svg' },
			})
		)
		const { container } = render(node)
		expect(container.querySelector('img')?.getAttribute('src')).toBe(
			'https://cms.example.com/api/10x-fields/flags/de.svg'
		)
		expect(screen.getByText('not-a-phone-number')).toBeDefined()
	})

	it('resolves the registry cellFormat default when the field layer specifies none', async () => {
		const node = await PhoneNumberCellServer(
			buildProps({
				cellData: DE_E164,
				payload: fakePayload({ cellFormat: 'national' }),
				phoneOptions: { flags: 'none' },
			})
		)
		render(node)
		expect(screen.getByText('01511 2345678')).toBeDefined()
	})

	it('falls back to the custom stamp when no phoneOptions clientProp is passed', async () => {
		const props = buildProps({
			cellData: DE_E164,
			custom: { [PHONE_CUSTOM_KEY]: { cellFormat: 'national', flags: 'none' } },
		})
		const node = await PhoneNumberCellServer(props)
		render(node)
		expect(screen.getByText('01511 2345678')).toBeDefined()
	})

	it('throws a named error with neither a phoneOptions prop nor a custom stamp', async () => {
		const props = buildProps({ cellData: DE_E164 })
		await expect(PhoneNumberCellServer(props)).rejects.toThrow(
			/PhoneNumberCellServer.*no phoneOptions/
		)
	})
})
