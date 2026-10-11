import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import type { GroupFieldClientProps } from 'payload'
import type { ComponentType, ReactNode } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { keys } from '../../translations/keys'
import { DateRangeField } from './ui'

const mocks = vi.hoisted(() => ({
	fields: {} as Record<string, { value: unknown }>,
	dispatchFields: vi.fn<(action: { type: string; path: string; value: unknown }) => void>(),
	setModified: vi.fn<(modified: boolean) => void>(),
}))

vi.mock('@payloadcms/ui/shared', () => ({ mergeFieldStyles: () => ({}) }))

vi.mock('@payloadcms/ui', () => ({
	DatePicker: ({
		onChange,
		overrides,
		placeholder,
	}: {
		onChange?: (picked: [Date | null, Date | null]) => void
		overrides?: { id?: string; startDate?: Date | null; endDate?: Date | null; maxDate?: Date }
		placeholder?: string
	}) => {
		const day = (date: Date | null | undefined): string =>
			date
				? `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
				: ''
		const date = (value: string | undefined): Date | null => {
			const [year, month, dayOfMonth] = (value ?? '').split('-').map(Number)
			return year && month && dayOfMonth ? new Date(year, month - 1, dayOfMonth) : null
		}
		return (
			<input
				data-max={day(overrides?.maxDate)}
				id={overrides?.id}
				onChange={(event) => {
					const [from, to] = event.target.value.split('..')
					onChange?.([date(from), date(to)])
				}}
				placeholder={placeholder}
				value={`${day(overrides?.startDate)}..${day(overrides?.endDate)}`}
			/>
		)
	},
	FieldDescription: () => null,
	FieldError: () => null,
	FieldLabel: ({ htmlFor, label }: { htmlFor?: string; label?: ReactNode }) => (
		<label htmlFor={htmlFor}>{label}</label>
	),
	TimezonePicker: () => null,
	useConfig: () => ({ config: { admin: {} } }),
	useForm: () => ({ dispatchFields: mocks.dispatchFields, setModified: mocks.setModified }),
	useFormFields: <T,>(selector: (context: [Record<string, { value: unknown }>]) => T): T =>
		selector([mocks.fields]),
	useTranslation: () => ({ i18n: { language: 'en' }, t: (key: string) => key }),
	withCondition: <P,>(component: ComponentType<P>) => component,
}))

afterEach(() => {
	cleanup()
	mocks.fields = {}
	mocks.dispatchFields.mockClear()
	mocks.setModified.mockClear()
})

const renderField = (readOnly = false, untilToday = false) =>
	render(
		<DateRangeField
			{...({
				field: { name: 'range', type: 'group', label: 'Date range', fields: [] },
				path: 'range',
				readOnly,
				...(untilToday ? { untilToday } : {}),
			} as unknown as GroupFieldClientProps)}
		/>
	)

const input = (): HTMLInputElement => screen.getByLabelText('Date range') as HTMLInputElement

describe('DateRangeField', () => {
	it('stores each picked day at its UTC midnight, which the widget reads back as that day', () => {
		renderField()
		fireEvent.change(input(), { target: { value: '2026-10-05..2026-10-14' } })
		expect(mocks.dispatchFields.mock.calls.map(([action]) => [action.path, action.value])).toEqual([
			['range.from', '2026-10-05T00:00:00.000Z'],
			['range.to', '2026-10-14T00:00:00.000Z'],
		])
		expect(mocks.setModified).toHaveBeenCalledWith(true)
	})

	it('shows the days the widget reads, wherever the bounds were stored from', () => {
		mocks.fields = {
			'range.from': { value: '2026-10-04T22:00:00.000Z' },
			'range.to': { value: '2026-10-14T00:00:00.000Z' },
		}
		renderField()
		expect(input().value).toBe('2026-10-05..2026-10-14')
		expect(input().placeholder).toBe(keys.dateRangePlaceholder)
	})

	it('changes nothing when read-only', () => {
		renderField(true)
		fireEvent.change(input(), { target: { value: '2026-10-05..2026-10-14' } })
		expect(mocks.dispatchFields).not.toHaveBeenCalled()
	})

	// A widget reports what already happened, so its range ends today at the latest.
	it('offers no day after today where it is told to, and any day otherwise', () => {
		renderField(false, true)
		const now = new Date()
		const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
		expect(input().getAttribute('data-max')).toBe(today)
		cleanup()
		renderField()
		expect(input().getAttribute('data-max')).toBe('')
	})
})
