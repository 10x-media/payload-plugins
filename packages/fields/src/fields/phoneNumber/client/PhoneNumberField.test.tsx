// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import type React from 'react'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import type { CountryOption } from '../engine/countries'
import { loadMetadata } from '../engine/metadata'
import type { CountryCode } from '../engine/phone'
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
const PICKABLE: CountryCode[] = ['CH', 'DE', 'US']

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
}

const element = (args: RenderArgs) => (
	<PhoneNumberField
		field={makeField(args.admin, { localized: args.localized, required: args.required })}
		path="phone"
		phoneOptions={{ ...OPTIONS, ...args.phoneOptions }}
		readOnly={args.readOnly ?? false}
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

	// Text that as-you-type leaves verbatim, so only the blur salvage can recover it
	it('salvages the first valid number out of a doubled paste on blur', async () => {
		await renderPhone({ phoneOptions: { defaultCountry: 'DE' } })
		type('tel:+41446681800 tel:+41446681800')
		expect(input().value).toBe('tel:+41446681800 tel:+41446681800')
		fireEvent.blur(input())
		expect(writesTo('phone.number')).toEqual(['+41446681800'])
		expect(writesTo('phone.country')).toEqual(['CH'])
		expect(input().value).toBe('44 668 18 00')
	})

	it('keeps an unparseable draft so validation can surface it', async () => {
		await renderPhone({ phoneOptions: { defaultCountry: 'DE' } })
		type('not a number')
		fireEvent.blur(input())
		expect(writesTo('phone.number')).toEqual(['not a number'])
		expect(input().value).toBe('not a number')
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

	// The first frame has to equal the frame the engine paints, or the prefix pops in and
	// shoves the entry sideways a quarter second after every document load.
	it('paints the first frame from the virtuals, identically to the engine', async () => {
		formFields.current = {
			'phone.callingCode': { value: '49' },
			'phone.country': { value: 'DE' },
			'phone.international': { value: '+49 1511 2345678' },
			'phone.number': { value: '+4915112345678' },
		}
		const rendered = render(element({}))
		const beforeMetadata = { prefix: prefix(), value: input().value }
		await act(async () => {
			await loadMetadata('max')
		})
		expect(beforeMetadata).toEqual({ prefix: '+49', value: '1511 2345678' })
		expect({ prefix: prefix(), value: input().value }).toEqual(beforeMetadata)
		rendered.unmount()
	})

	it('ignores virtuals that do not belong to the stored number', async () => {
		formFields.current = {
			'phone.callingCode': { value: '41' },
			'phone.country': { value: 'DE' },
			'phone.international': { value: '+41 44 668 18 00' },
			'phone.number': { value: '+4915112345678' },
		}
		const rendered = render(element({}))
		expect(prefix()).toBeNull()
		expect(input().value).toBe('+4915112345678')
		rendered.unmount()
	})

	it('has no virtuals to paint from under e164 storage', async () => {
		fieldStub.current = { ...fieldStub.current, value: '+4915112345678' }
		formFields.current = {
			'phone.callingCode': { value: '49' },
			'phone.international': { value: '+49 1511 2345678' },
		}
		const rendered = render(element({ phoneOptions: { storage: 'e164' } }))
		expect(prefix()).toBeNull()
		expect(input().value).toBe('+4915112345678')
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
