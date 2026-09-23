// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import type React from 'react'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import type { CountryOption } from '../engine/countries'
import { loadMetadata } from '../engine/metadata'
import type { CountryCode, PhoneSeed } from '../engine/phone'
import type { PhoneClientOptions } from '../options'

type FieldAction = { path: string; type: string; value: unknown }

const formFields: { current: Record<string, { value?: unknown } | undefined> } = { current: {} }

// Both doubles apply the write, so a committed value comes back through the same path the
// component reads it from, exactly as Payload's reducer and setValue do.
const dispatchFields = vi.fn<(action: FieldAction) => void>((action) => {
	if (action.type !== 'UPDATE') return
	formFields.current = { ...formFields.current, [action.path]: { value: action.value } }
})
const setModified = vi.fn<(modified: boolean) => void>()
const setValue = vi.fn<(value: unknown) => void>((next) => {
	fieldStub.current = { ...fieldStub.current, value: next }
})

type UseFieldStub = {
	customComponents: Record<string, React.ReactNode>
	disabled: boolean
	errorPaths: string[]
	formSubmitted: boolean
	path: string
	setValue: typeof setValue
	showError: boolean
	value?: unknown
}

const cleanFieldStub = (): UseFieldStub => ({
	customComponents: {},
	disabled: false,
	errorPaths: [],
	formSubmitted: false,
	path: 'phone',
	setValue,
	showError: false,
})

const fieldStub: { current: UseFieldStub } = { current: cleanFieldStub() }

const labelProps = vi.fn<(props: Record<string, unknown>) => void>()
const errorProps = vi.fn<(props: Record<string, unknown>) => void>()
const descriptionProps = vi.fn<(props: Record<string, unknown>) => void>()

type LabelDoubleProps = { label?: unknown; localized?: boolean; path: string; required?: boolean }
const FieldLabelDouble = (props: LabelDoubleProps) => {
	labelProps(props as Record<string, unknown>)
	return <span data-testid="label">{String(props.label ?? '')}</span>
}

type ErrorDoubleProps = { path: string; showError?: boolean }
const FieldErrorDouble = (props: ErrorDoubleProps) => {
	errorProps(props as Record<string, unknown>)
	return props.showError ? <span data-testid="error" /> : null
}

type DescriptionDoubleProps = { description?: unknown; path: string }
const FieldDescriptionDouble = (props: DescriptionDoubleProps) => {
	descriptionProps(props as Record<string, unknown>)
	return <span data-testid="description">{String(props.description ?? '')}</span>
}

const RenderCustomComponentDouble = ({
	CustomComponent,
	Fallback,
}: {
	CustomComponent?: React.ReactNode
	Fallback: React.ReactNode
}) => <>{CustomComponent ?? Fallback}</>

vi.mock('@payloadcms/ui', () => ({
	FieldDescription: FieldDescriptionDouble,
	FieldError: FieldErrorDouble,
	FieldLabel: FieldLabelDouble,
	RenderCustomComponent: RenderCustomComponentDouble,
	XIcon: () => <svg data-testid="x-icon" />,
	fieldBaseClass: 'field-type',
	useField: () => fieldStub.current,
	useForm: () => ({ dispatchFields, setModified }),
	useFormFields: (
		selector: (context: [Record<string, { value?: unknown } | undefined>, unknown]) => unknown
	) => selector([formFields.current, dispatchFields]),
}))

vi.mock('@payloadcms/ui/shared', () => ({
	mergeFieldStyles: (field: { admin?: { width?: string } }) => ({
		'--field-width': field.admin?.width ?? 'auto',
	}),
}))

vi.mock('../../../translations/useTranslation', () => ({
	useTranslation: () => ({
		i18n: { language: 'en' },
		t: (key: string, vars?: Record<string, unknown>) =>
			vars ? `${key} ${Object.values(vars).join(' ')}` : key,
	}),
}))

/** Countries the picker double offers, enough to drive every selection this file needs. */
const PICKABLE: CountryCode[] = ['CA', 'CH', 'DE', 'US']

type PickerDoubleProps = {
	disabled: boolean
	flags: string
	onSelect: (code: CountryCode) => void
	options: { preferred: CountryOption[]; rest: CountryOption[] }
	value: CountryCode | undefined
}

const CountryPickerDouble = ({ disabled, flags, onSelect, options, value }: PickerDoubleProps) => (
	<div
		data-disabled={String(disabled)}
		data-flags={flags}
		data-preferred={options.preferred.map((option) => option.code).join(',')}
		data-testid="picker"
		data-total={String(options.preferred.length + options.rest.length)}
		data-value={value ?? ''}
	>
		{PICKABLE.map((code) => (
			<button key={code} onClick={() => onSelect(code)} type="button">
				{`pick-${code}`}
			</button>
		))}
	</div>
)

vi.mock('./CountryPicker', () => ({ CountryPicker: CountryPickerDouble }))

const { PhoneNumberField } = await import('./PhoneNumberField')

type PhoneFieldProps = Parameters<typeof PhoneNumberField>[0]

const OPTIONS: PhoneClientOptions = {
	cellFormat: 'international',
	flags: 'svg',
	isClearable: true,
	metadata: 'max',
	storage: 'object',
	validation: 'valid',
}

type FieldAdmin = {
	className?: string
	description?: string
	placeholder?: Record<string, string> | string
	readOnly?: boolean
	width?: string
}

const makeField = (
	admin: FieldAdmin = {},
	extra: { localized?: boolean; required?: boolean } = {}
) =>
	({
		admin,
		fields: [],
		label: 'Phone',
		localized: extra.localized ?? false,
		name: 'phone',
		required: extra.required ?? false,
		type: 'group',
	}) as unknown as PhoneFieldProps['field']

type RenderArgs = {
	admin?: FieldAdmin
	localized?: boolean
	phoneOptions?: Partial<PhoneClientOptions>
	readOnly?: boolean
	required?: boolean
	seed?: null | PhoneSeed
}

const element = (args: RenderArgs) => (
	<PhoneNumberField
		field={makeField(args.admin, { localized: args.localized, required: args.required })}
		path="phone"
		phoneOptions={{ ...OPTIONS, ...args.phoneOptions }}
		readOnly={args.readOnly ?? false}
		seed={args.seed ?? null}
	/>
)

const input = (): HTMLInputElement => {
	const found = document.querySelector<HTMLInputElement>('.fields-phone__input')
	if (!found) throw new Error('the phone input is not rendered')
	return found
}

const root = (): HTMLElement => {
	const found = document.querySelector<HTMLElement>('.fields-phone')
	if (!found) throw new Error('the phone field root is not rendered')
	return found
}

const picker = (): HTMLElement => screen.getByTestId('picker')

const prefix = (): null | string =>
	document.querySelector('.fields-phone__prefix')?.textContent ?? null

const clearButton = (): HTMLButtonElement | null =>
	document.querySelector<HTMLButtonElement>('.fields-phone__clear')

/** Values written to one flat subfield path, in dispatch order. */
const writesTo = (path: string): unknown[] =>
	dispatchFields.mock.calls
		.map(([action]) => action)
		.filter((action) => action.path === path)
		.map((action) => action.value)

const type = (value: string, selectionStart?: number) =>
	fireEvent.change(
		input(),
		selectionStart === undefined ? { target: { value } } : { target: { selectionStart, value } }
	)

/** One keystroke at the end of the line, which is what the length ceiling bounds. */
const press = (char: string) => type(`${input().value}${char}`)

/** Renders and flushes the lazy metadata load, so formatting is active. */
const renderPhone = async (args: RenderArgs = {}) => {
	const rendered = render(element(args))
	await act(async () => {
		await loadMetadata('max')
	})
	return {
		...rendered,
		rerender: (next: RenderArgs = args) => rendered.rerender(element(next)),
	}
}

beforeAll(async () => {
	await loadMetadata('max')
})

describe('PhoneNumberField', () => {
	afterEach(() => {
		cleanup()
		formFields.current = {}
		fieldStub.current = cleanFieldStub()
		dispatchFields.mockClear()
		setModified.mockClear()
		setValue.mockClear()
		labelProps.mockClear()
		errorProps.mockClear()
		descriptionProps.mockClear()
	})

	it('renders the native label, error and description by default', async () => {
		await renderPhone({ admin: { description: 'Work number' } })
		expect(screen.getByTestId('label').textContent).toBe('Phone')
		expect(screen.getByTestId('description').textContent).toBe('Work number')
		expect(errorProps.mock.lastCall?.[0]).toMatchObject({ path: 'phone' })
	})

	it('lets server-provided Label, Error and Description components win', async () => {
		fieldStub.current = {
			...fieldStub.current,
			customComponents: {
				Description: <span data-testid="custom-description" />,
				Error: <span data-testid="custom-error" />,
				Label: <span data-testid="custom-label" />,
			},
		}
		await renderPhone()
		expect(screen.getByTestId('custom-label')).toBeDefined()
		expect(screen.getByTestId('custom-error')).toBeDefined()
		expect(screen.getByTestId('custom-description')).toBeDefined()
		expect(screen.queryByTestId('label')).toBeNull()
		expect(screen.queryByTestId('description')).toBeNull()
	})

	it('renders beforeInput and afterInput around the input row', async () => {
		fieldStub.current = {
			...fieldStub.current,
			customComponents: {
				AfterInput: <span data-testid="after" />,
				BeforeInput: <span data-testid="before" />,
			},
		}
		await renderPhone()
		const container = document.querySelector('.fields-phone__container')
		expect(container).not.toBeNull()
		const before = screen.getByTestId('before')
		const after = screen.getByTestId('after')
		expect(before.compareDocumentPosition(container as Node)).toBe(Node.DOCUMENT_POSITION_FOLLOWING)
		expect(after.compareDocumentPosition(container as Node)).toBe(Node.DOCUMENT_POSITION_PRECEDING)
	})

	it('hands required and localized to the native label, which draws the asterisk', async () => {
		await renderPhone({ localized: true, required: true })
		expect(labelProps.mock.lastCall?.[0]).toMatchObject({
			label: 'Phone',
			localized: true,
			path: 'phone',
			required: true,
		})
	})

	it('applies the merged field styles and admin.className to the root', async () => {
		await renderPhone({ admin: { className: 'custom-phone', width: '50%' } })
		expect(root().classList.contains('custom-phone')).toBe(true)
		expect(root().style.getPropertyValue('--field-width')).toBe('50%')
	})

	it('passes admin.placeholder to the input', async () => {
		await renderPhone({ admin: { placeholder: 'Work number' } })
		expect(input().placeholder).toBe('Work number')
	})

	it('resolves a localized admin.placeholder for the admin language', async () => {
		await renderPhone({ admin: { placeholder: { de: 'Nummer', en: 'Work number' } } })
		expect(input().placeholder).toBe('Work number')
	})

	it('asks for the phone keypad rather than a plain text field', async () => {
		await renderPhone()
		expect(input().type).toBe('tel')
		expect(input().inputMode).toBe('tel')
	})

	it.each([
		['the readOnly prop', { readOnly: true }],
		['field.admin.readOnly', { admin: { readOnly: true } }],
	])('is read-only through %s', async (_label, args: RenderArgs) => {
		formFields.current = { 'phone.number': { value: '+4915112345678' } }
		await renderPhone(args)
		expect(input().readOnly).toBe(true)
		expect(picker().dataset.disabled).toBe('true')
		expect(clearButton()).toBeNull()
		expect(root().classList.contains('read-only')).toBe(true)
	})

	it('is read-only while the form is processing', async () => {
		fieldStub.current = { ...fieldStub.current, disabled: true }
		await renderPhone()
		expect(input().readOnly).toBe(true)
	})

	it('paints the stored number from the flat subfield paths', async () => {
		formFields.current = {
			'phone.country': { value: 'DE' },
			'phone.number': { value: '+4915112345678' },
		}
		await renderPhone()
		expect(input().value).toBe('1511 2345678')
		expect(picker().dataset.value).toBe('DE')
		expect(prefix()).toBe('+49')
	})

	// buildFormState does not run afterRead, so the virtual subfields are stale mid-edit
	it('paints from the engine, never from the virtual subfields', async () => {
		formFields.current = {
			'phone.country': { value: 'DE' },
			'phone.international': { value: 'STALE INTERNATIONAL' },
			'phone.national': { value: 'STALE NATIONAL' },
			'phone.number': { value: '+4915112345678' },
		}
		await renderPhone()
		expect(input().value).toBe('1511 2345678')
	})

	it('formats as you type while appending at the end', async () => {
		await renderPhone({ phoneOptions: { defaultCountry: 'DE' } })
		type('1511')
		expect(input().value).toBe('1511')
		type('15112345678')
		expect(input().value).toBe('1511 2345678')
	})

	it('leaves a mid-string insertion exactly as typed', async () => {
		await renderPhone({ phoneOptions: { defaultCountry: 'DE' } })
		type('15112345')
		expect(input().value).toBe('1511 2345')
		type('15911 2345', 3)
		expect(input().value).toBe('15911 2345')
		expect(input().selectionStart).toBe(3)
	})

	it('leaves a deletion exactly as typed, so a separator never grows back', async () => {
		await renderPhone({ phoneOptions: { defaultCountry: 'DE' } })
		type('15112345')
		expect(input().value).toBe('1511 2345')
		type('1511234')
		expect(input().value).toBe('1511234')
	})

	it('normalizes to E.164 on blur and writes both subfields', async () => {
		await renderPhone({ phoneOptions: { defaultCountry: 'DE' } })
		type('15112345678')
		fireEvent.blur(input())
		expect(writesTo('phone.number')).toEqual(['+4915112345678'])
		expect(writesTo('phone.country')).toEqual(['DE'])
		expect(input().value).toBe('1511 2345678')
	})

	// dispatchFields, unlike setValue, does not mark the form modified
	it('marks the form modified itself when it writes the subfields', async () => {
		await renderPhone({ phoneOptions: { defaultCountry: 'DE' } })
		type('15112345678')
		fireEvent.blur(input())
		expect(setModified).toHaveBeenCalledWith(true)
	})

	it('commits without a blur once typing settles', async () => {
		await renderPhone({ phoneOptions: { defaultCountry: 'DE' } })
		vi.useFakeTimers()
		try {
			type('15112345678')
			expect(writesTo('phone.number')).toEqual([])
			act(() => {
				vi.advanceTimersByTime(400)
			})
			expect(writesTo('phone.number')).toEqual(['+4915112345678'])
		} finally {
			vi.useRealTimers()
		}
	})

	// A debounced commit normalizes the stored value; repainting the input from it would
	// rewrite the line under the viewer's caret
	it('leaves the draft alone when the debounced commit normalizes it', async () => {
		const { rerender } = await renderPhone({ phoneOptions: { defaultCountry: 'DE' } })
		vi.useFakeTimers()
		try {
			type('+41446681800')
			expect(input().value).toBe('+41 44 668 18 00')
			act(() => {
				vi.advanceTimersByTime(400)
			})
			expect(writesTo('phone.number')).toEqual(['+41446681800'])
			// The committed value would paint as "44 668 18 00"; the form re-renders around
			// the viewer constantly, and none of those renders may touch the line being typed
			rerender()
			expect(input().value).toBe('+41 44 668 18 00')
		} finally {
			vi.useRealTimers()
		}
	})

	it('drops a pending commit when the input is blurred', async () => {
		await renderPhone({ phoneOptions: { defaultCountry: 'DE' } })
		vi.useFakeTimers()
		try {
			type('15112345678')
			fireEvent.blur(input())
			act(() => {
				vi.advanceTimersByTime(400)
			})
			expect(writesTo('phone.number')).toEqual(['+4915112345678'])
		} finally {
			vi.useRealTimers()
		}
	})

	it('switches the country when an international number is pasted', async () => {
		await renderPhone({ phoneOptions: { defaultCountry: 'DE' } })
		type('+41 44 668 1800')
		expect(picker().dataset.value).toBe('CH')
		expect(prefix()).toBeNull()
		fireEvent.blur(input())
		expect(writesTo('phone.number')).toEqual(['+41446681800'])
		expect(writesTo('phone.country')).toEqual(['CH'])
		expect(input().value).toBe('44 668 18 00')
		expect(prefix()).toBe('+41')
	})

	// A paste no single parse can read, so only the blur salvage can recover it
	it('salvages the first valid number out of a doubled paste on blur', async () => {
		await renderPhone({ phoneOptions: { defaultCountry: 'DE' } })
		type('+41446681800 +41446681800')
		fireEvent.blur(input())
		expect(writesTo('phone.number')).toEqual(['+41446681800'])
		expect(writesTo('phone.country')).toEqual(['CH'])
		expect(input().value).toBe('44 668 18 00')
	})

	it('keeps an unparseable draft so validation can surface it', async () => {
		await renderPhone({ phoneOptions: { defaultCountry: 'DE' } })
		type('+999 123')
		fireEvent.blur(input())
		expect(writesTo('phone.number')).toEqual(['+999123'])
		expect(input().value).toBe('+999123')
	})

	it.each([
		['a letter', 'not a number'],
		['an extension', '1511 2345678 x99'],
		['a tel URI', 'tel:+4915112345678'],
	])('refuses %s rather than letting it into the draft', async (_label, raw) => {
		await renderPhone({ phoneOptions: { defaultCountry: 'DE' } })
		type('1511 2345678')
		type(raw)
		expect(input().value).toBe('1511 2345678')
	})

	// Refusing by re-rendering the old value would drop the caret to the end of the line
	it('leaves the caret at the edit point when a character is refused', async () => {
		await renderPhone({ phoneOptions: { defaultCountry: 'DE' } })
		type('15112345678')
		expect(input().value).toBe('1511 2345678')
		type('1511a 2345678', 5)
		expect(input().value).toBe('1511 2345678')
		expect(input().selectionStart).toBe(4)
	})

	// The United States caps its national numbers at ten digits
	it('refuses a typed digit past the ceiling the country defines', async () => {
		await renderPhone({ phoneOptions: { defaultCountry: 'US' } })
		type('2025550123')
		const full = input().value
		press('4')
		expect(input().value).toBe(full)
	})

	// Germany defines no upper bound, so only E.164's fifteen digits stop the entry growing
	it('refuses a typed digit past E.164 where the country defines no ceiling', async () => {
		await renderPhone({ phoneOptions: { defaultCountry: 'DE' } })
		type('151123456789')
		press('0')
		const full = input().value
		expect(full.replace(/\D/g, '')).toBe('1511234567890')
		press('1')
		expect(input().value).toBe(full)
	})

	it('lets a refused entry shrink and grow again', async () => {
		await renderPhone({ phoneOptions: { defaultCountry: 'US' } })
		type('2025550123')
		const full = input().value
		press('4')
		expect(input().value).toBe(full)
		type('202 555 012')
		expect(input().value).toBe('202 555 012')
		press('4')
		expect(input().value.replace(/\D/g, '')).toBe('2025550124')
	})

	// The ceiling bounds typing; a paste has to land for the blur salvage to read it
	it('lets a bulk paste past the ceiling through', async () => {
		await renderPhone({ phoneOptions: { defaultCountry: 'DE' } })
		type('+41446681800 +41446681800')
		expect(input().value).not.toBe('')
		fireEvent.blur(input())
		expect(writesTo('phone.number')).toEqual(['+41446681800'])
	})

	it('re-reads a typed number under a country picked from the list', async () => {
		await renderPhone({ phoneOptions: { defaultCountry: 'DE' } })
		type('4155552671')
		fireEvent.click(screen.getByText('pick-US'))
		expect(writesTo('phone.number')).toEqual(['+14155552671'])
		expect(writesTo('phone.country')).toEqual(['US'])
		expect(input().value).toBe('415 555 2671')
		expect(prefix()).toBe('+1')
	})

	it.each([
		['+41', 'CH'],
		['+1', 'US'],
		['+7', 'RU'],
		['+44', 'GB'],
	])('adopts the country %s identifies before the number is complete', async (draft, expected) => {
		await renderPhone({ phoneOptions: { defaultCountry: 'DE' } })
		type(draft)
		expect(picker().dataset.value).toBe(expected)
	})

	it('refines the country once the digits name one within the calling code', async () => {
		await renderPhone({ phoneOptions: { defaultCountry: 'DE' } })
		type('+1')
		expect(picker().dataset.value).toBe('US')
		type('+16045551234')
		expect(picker().dataset.value).toBe('CA')
	})

	it('leaves the country alone for a calling code no country claims', async () => {
		await renderPhone({ phoneOptions: { defaultCountry: 'DE' } })
		type('+999')
		expect(picker().dataset.value).toBe('DE')
	})

	// Without shedding the code, the draft would name the old country straight back over the pick
	it('sheds the calling code of a draft too short to parse when a country is picked', async () => {
		await renderPhone({ phoneOptions: { defaultCountry: 'DE' } })
		type('+1')
		expect(picker().dataset.value).toBe('US')
		fireEvent.click(screen.getByText('pick-CH'))
		expect(picker().dataset.value).toBe('CH')
		expect(prefix()).toBe('+41')
		expect(input().value).toBe('')
	})

	it('keeps the digits after the calling code when a country is picked', async () => {
		await renderPhone({ phoneOptions: { defaultCountry: 'DE' } })
		type('+1604')
		fireEvent.click(screen.getByText('pick-CH'))
		expect(picker().dataset.value).toBe('CH')
		expect(input().value).toBe('604')
	})

	// libphonenumber reads the country back off the area code, which for a shared calling code
	// answers a different country than the one the viewer just chose
	it('keeps a picked country the stored number would re-derive away from', async () => {
		formFields.current = {
			'phone.country': { value: 'US' },
			'phone.number': { value: '+12125552368' },
		}
		await renderPhone()
		expect(picker().dataset.value).toBe('US')
		fireEvent.click(screen.getByText('pick-CA'))
		expect(writesTo('phone.country')).toEqual(['CA'])
		expect(picker().dataset.value).toBe('CA')
	})

	// e164 storage has no country column, so component state is the only place a pick can live
	it('keeps a picked country under e164 storage, where the number re-derives another', async () => {
		fieldStub.current = { ...fieldStub.current, value: '+12125552368' }
		await renderPhone({ phoneOptions: { storage: 'e164' } })
		expect(picker().dataset.value).toBe('US')
		fireEvent.click(screen.getByText('pick-CA'))
		expect(picker().dataset.value).toBe('CA')
	})

	// A pick answers for one number, it is not a mode the field stays in
	it('drops a picked country once a committed number names its own', async () => {
		await renderPhone({ phoneOptions: { defaultCountry: 'DE' } })
		fireEvent.click(screen.getByText('pick-CA'))
		expect(picker().dataset.value).toBe('CA')
		type('+41 44 668 1800')
		fireEvent.blur(input())
		expect(writesTo('phone.country')).toEqual(['CA', 'CH'])
		expect(picker().dataset.value).toBe('CH')
	})

	it('lets a typed international draft outrank a picked country', async () => {
		await renderPhone({ phoneOptions: { defaultCountry: 'DE' } })
		fireEvent.click(screen.getByText('pick-CA'))
		type('+41 44 668 1800')
		expect(picker().dataset.value).toBe('CH')
	})

	// Switching documents remounts the field, which must read the row rather than the pick
	it('starts a remounted field from the stored country, not the pick', async () => {
		const stored = {
			'phone.country': { value: 'US' },
			'phone.number': { value: '+12125552368' },
		}
		formFields.current = { ...stored }
		const { unmount } = await renderPhone()
		fireEvent.click(screen.getByText('pick-CA'))
		expect(picker().dataset.value).toBe('CA')
		unmount()
		formFields.current = { ...stored }
		await renderPhone()
		expect(picker().dataset.value).toBe('US')
	})

	// The pick wins over the calling code already in the draft, which is dropped with it
	it('re-reads an international draft under a country picked from the list', async () => {
		await renderPhone({ phoneOptions: { defaultCountry: 'DE' } })
		type('+41 44 668 1800')
		expect(picker().dataset.value).toBe('CH')
		fireEvent.click(screen.getByText('pick-US'))
		expect(writesTo('phone.country')).toEqual(['US'])
		expect(picker().dataset.value).toBe('US')
		expect(input().value).not.toContain('+41')
	})

	it('empties both subfields from the clear control', async () => {
		formFields.current = {
			'phone.country': { value: 'DE' },
			'phone.number': { value: '+4915112345678' },
		}
		await renderPhone()
		const clear = clearButton()
		expect(clear).not.toBeNull()
		fireEvent.click(clear as HTMLButtonElement)
		expect(writesTo('phone.number')).toEqual([null])
		expect(writesTo('phone.country')).toEqual([null])
		expect(setModified).toHaveBeenCalledWith(true)
		expect(input().value).toBe('')
	})

	// The control unmounts on the same commit, so focus has to go somewhere deliberate
	it('moves focus to the input when the clear control is used', async () => {
		formFields.current = { 'phone.number': { value: '+4915112345678' } }
		await renderPhone()
		const clear = clearButton() as HTMLButtonElement
		clear.focus()
		fireEvent.click(clear)
		expect(clearButton()).toBeNull()
		expect(document.activeElement).toBe(input())
	})

	// The emptied country subfield and the trigger must agree, or the form would save a
	// country the viewer can still see selected
	it('drops a picked country when the value is cleared', async () => {
		formFields.current = { 'phone.number': { value: '+4915112345678' } }
		await renderPhone({ phoneOptions: { defaultCountry: 'DE' } })
		fireEvent.click(screen.getByText('pick-CH'))
		expect(picker().dataset.value).toBe('CH')
		fireEvent.click(clearButton() as HTMLButtonElement)
		expect(picker().dataset.value).toBe('DE')
	})

	it.each([
		['the field is required', { required: true }],
		['isClearable is false', { phoneOptions: { isClearable: false } }],
	])('hides the clear control when %s', async (_label, args: RenderArgs) => {
		formFields.current = { 'phone.number': { value: '+4915112345678' } }
		await renderPhone(args)
		expect(clearButton()).toBeNull()
	})

	it('hides the clear control while the field is empty', async () => {
		await renderPhone()
		expect(clearButton()).toBeNull()
	})

	// isClearable false means the value cannot be removed, only replaced
	it('reverts an emptied input to the last valid value when it is not clearable', async () => {
		formFields.current = {
			'phone.country': { value: 'DE' },
			'phone.number': { value: '+4915112345678' },
		}
		await renderPhone({ phoneOptions: { isClearable: false } })
		type('')
		fireEvent.blur(input())
		expect(writesTo('phone.number')).toEqual(['+4915112345678'])
		expect(input().value).toBe('1511 2345678')
	})

	it('never reverts to a stored value that does not parse', async () => {
		formFields.current = { 'phone.number': { value: 'not a number' } }
		await renderPhone({ phoneOptions: { defaultCountry: 'DE', isClearable: false } })
		expect(input().value).toBe('not a number')
		type('')
		fireEvent.blur(input())
		expect(writesTo('phone.number')).toEqual([null])
	})

	it('lets a never-set non-clearable field stay empty', async () => {
		await renderPhone({ phoneOptions: { defaultCountry: 'DE', isClearable: false } })
		type('1')
		type('')
		fireEvent.blur(input())
		expect(writesTo('phone.number')).toEqual([null])
	})

	it('treats a whitespace-only draft as emptied', async () => {
		formFields.current = {
			'phone.country': { value: 'DE' },
			'phone.number': { value: '+4915112345678' },
		}
		await renderPhone()
		type('   ')
		fireEvent.blur(input())
		expect(writesTo('phone.number')).toEqual([null])
	})

	it('clears an emptied input when the field is clearable', async () => {
		formFields.current = {
			'phone.country': { value: 'DE' },
			'phone.number': { value: '+4915112345678' },
		}
		await renderPhone()
		type('')
		fireEvent.blur(input())
		expect(writesTo('phone.number')).toEqual([null])
	})

	it('shows the error state when a child path is invalid but the group itself is not', async () => {
		fieldStub.current = {
			...fieldStub.current,
			errorPaths: ['phone.number'],
			formSubmitted: true,
		}
		await renderPhone()
		expect(root().classList.contains('error')).toBe(true)
		expect(screen.getByTestId('error')).toBeDefined()
	})

	it('leaves the error state alone before the form is submitted', async () => {
		fieldStub.current = { ...fieldStub.current, errorPaths: ['phone.number'] }
		await renderPhone()
		expect(root().classList.contains('error')).toBe(false)
	})

	it('threads the configured countries and flag mode into the picker', async () => {
		await renderPhone({
			phoneOptions: {
				countries: ['CH', 'DE', 'US'],
				flags: 'emoji',
				preferredCountries: ['DE'],
			},
		})
		expect(picker().dataset.total).toBe('3')
		expect(picker().dataset.preferred).toBe('DE')
		expect(picker().dataset.flags).toBe('emoji')
	})

	it('renders the full row before the metadata lands and keeps the first keystroke', () => {
		render(element({ phoneOptions: { defaultCountry: 'DE' } }))
		expect(document.querySelector('.fields-phone__container')).not.toBeNull()
		expect(picker().dataset.disabled).toBe('true')
		type('15112345678')
		expect(input().value).toBe('15112345678')
	})

	const DE_SEED: PhoneSeed = {
		callingCode: '49',
		country: 'DE',
		national: '1511 2345678',
		number: '+4915112345678',
	}

	// The first frame has to equal the frame the engine paints, or the prefix pops in and
	// shoves the entry sideways a quarter second after every document load.
	it.each([
		['object storage', {} as RenderArgs],
		['e164 storage', { phoneOptions: { storage: 'e164' } } as RenderArgs],
	])('paints the first frame from the server seed under %s', async (_label, args) => {
		fieldStub.current = { ...fieldStub.current, value: DE_SEED.number }
		formFields.current = {
			'phone.country': { value: 'DE' },
			'phone.number': { value: DE_SEED.number },
		}
		const rendered = render(element({ ...args, seed: DE_SEED }))
		const beforeMetadata = {
			country: picker().dataset.value,
			prefix: prefix(),
			value: input().value,
		}
		await act(async () => {
			await loadMetadata('max')
		})
		expect(beforeMetadata).toEqual({ country: 'DE', prefix: '+49', value: '1511 2345678' })
		expect({ country: picker().dataset.value, prefix: prefix(), value: input().value }).toEqual(
			beforeMetadata
		)
		rendered.unmount()
	})

	it('ignores a seed that does not describe the stored number', async () => {
		formFields.current = {
			'phone.country': { value: 'DE' },
			'phone.number': { value: '+4915112345678' },
		}
		const seed: PhoneSeed = {
			callingCode: '41',
			country: 'CH',
			national: '44 668 18 00',
			number: '+41446681800',
		}
		const rendered = render(element({ seed }))
		expect(prefix()).toBeNull()
		expect(input().value).toBe('+4915112345678')
		rendered.unmount()
	})

	// A `countries` allowlist filters the picker, not what a pasted number may commit, so the
	// prefix has to come off the country itself or the row reflows back when metadata lands.
	it('keeps the prefix for a stored country the allowlist does not offer', async () => {
		formFields.current = {
			'phone.country': { value: 'JP' },
			'phone.number': { value: '+819012345678' },
		}
		const seed: PhoneSeed = {
			callingCode: '81',
			country: 'JP',
			national: '90 1234 5678',
			number: '+819012345678',
		}
		const rendered = render(element({ phoneOptions: { countries: ['DE', 'FR'] }, seed }))
		const beforeMetadata = { prefix: prefix(), value: input().value }
		await act(async () => {
			await loadMetadata('max')
		})
		expect(picker().dataset.total).toBe('2')
		expect(beforeMetadata).toEqual({ prefix: '+81', value: '90 1234 5678' })
		expect({ prefix: prefix(), value: input().value }).toEqual(beforeMetadata)
		rendered.unmount()
	})

	it('drops the seed the moment the metadata lands', async () => {
		formFields.current = {
			'phone.country': { value: 'CH' },
			'phone.number': { value: '+41446681800' },
		}
		// A seed left over from a number that is no longer the one in form state
		const rendered = render(element({ seed: { ...DE_SEED, number: '+41446681800' } }))
		expect(input().value).toBe('1511 2345678')
		await act(async () => {
			await loadMetadata('max')
		})
		expect(input().value).toBe('44 668 18 00')
		expect(prefix()).toBe('+41')
		rendered.unmount()
	})

	it('activates formatting once the metadata lands, without losing the draft', async () => {
		const rendered = render(element({ phoneOptions: { defaultCountry: 'DE' } }))
		type('1511234')
		await act(async () => {
			await loadMetadata('max')
		})
		expect(input().value).toBe('1511234')
		expect(picker().dataset.disabled).toBe('false')
		type('15112345678')
		expect(input().value).toBe('1511 2345678')
		rendered.unmount()
	})

	it('writes the field path itself under e164 storage', async () => {
		fieldStub.current = { ...fieldStub.current, value: '+4915112345678' }
		await renderPhone({ phoneOptions: { storage: 'e164' } })
		expect(input().value).toBe('1511 2345678')
		expect(picker().dataset.value).toBe('DE')
		type('+41 44 668 1800')
		fireEvent.blur(input())
		expect(setValue).toHaveBeenCalledWith('+41446681800')
		expect(dispatchFields).not.toHaveBeenCalled()
	})

	it('keeps a country picked on an empty e164 field', async () => {
		await renderPhone({ phoneOptions: { storage: 'e164' } })
		fireEvent.click(screen.getByText('pick-CH'))
		expect(picker().dataset.value).toBe('CH')
	})
})
