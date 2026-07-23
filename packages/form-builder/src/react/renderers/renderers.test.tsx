import { cleanup, fireEvent, render, within } from '@testing-library/react'
import { createElement } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { FieldRendererProps } from '../contract'
import { checkboxRenderer } from './checkbox'
import { dateRenderer } from './date'
import { emailRenderer } from './email'
import { numberRenderer } from './number'
import { selectRenderer } from './select'
import { textRenderer } from './text'
import { textareaRenderer } from './textarea'

afterEach(() => {
	cleanup()
})

const baseProps = <T,>(overrides: Partial<FieldRendererProps<T>>): FieldRendererProps<T> => ({
	field: { blockType: 'text', name: 'f', label: 'Field' },
	id: 'x',
	name: 'f',
	value: undefined,
	onChange: () => {},
	onBlur: () => {},
	errors: [],
	required: false,
	locale: 'en',
	t: (key) => key,
	...overrides,
})

describe('built-in field renderers', () => {
	it('honor the passed id prop for the control and its describedby, never self-minting one', () => {
		const cases = [
			[textRenderer, { blockType: 'text', name: 'f', label: 'F' }],
			[emailRenderer, { blockType: 'email', name: 'f', label: 'F' }],
			[numberRenderer, { blockType: 'number', name: 'f', label: 'F' }],
			[dateRenderer, { blockType: 'date', name: 'f', label: 'F' }],
			[textareaRenderer, { blockType: 'textarea', name: 'f', label: 'F' }],
			[checkboxRenderer, { blockType: 'checkbox', name: 'f', label: 'F' }],
			[selectRenderer, { blockType: 'select', name: 'f', label: 'F', options: [] }],
		] as const
		for (const [renderer, field] of cases) {
			// A colon-bearing useId() value (e.g. `:r0:`) would never be queryable as `#passed-id`.
			const { container } = render(createElement(renderer, baseProps({ id: 'passed-id', field })))
			const control = container.querySelector('#passed-id')
			expect(control, `${field.blockType} uses the passed id`).not.toBeNull()
			expect(control?.getAttribute('aria-describedby')).toBe('passed-id-desc')
			cleanup()
		}
	})

	it('text: reflects value, fires onChange, shows error with aria-invalid', () => {
		const onChange = vi.fn()
		const { container } = render(
			createElement(textRenderer, baseProps<string>({ value: 'hi', onChange, errors: ['Bad'] }))
		)
		const input = within(container).getByRole('textbox')
		expect(input).toHaveValue('hi')
		expect(input).toHaveAttribute('aria-invalid', 'true')
		expect(within(container).getByRole('alert')).toHaveTextContent('Bad')
		fireEvent.change(input, { target: { value: 'bye' } })
		expect(onChange).toHaveBeenCalledWith('bye')
	})

	it('email: renders an email-typed input', () => {
		const { container } = render(
			createElement(
				emailRenderer,
				baseProps<string>({ field: { blockType: 'email', name: 'e', label: 'E' } })
			)
		)
		expect(within(container).getByRole('textbox')).toHaveAttribute('type', 'email')
	})

	it('textarea: renders a textarea and fires onChange', () => {
		const onChange = vi.fn()
		const { container } = render(
			createElement(
				textareaRenderer,
				baseProps<string>({ field: { blockType: 'textarea', name: 'ta', label: 'TA' }, onChange })
			)
		)
		const textarea = within(container).getByRole('textbox')
		expect(textarea.tagName).toBe('TEXTAREA')
		fireEvent.change(textarea, { target: { value: 'long' } })
		expect(onChange).toHaveBeenCalledWith('long')
	})

	it('number: emits a number, and undefined when cleared', () => {
		const onChange = vi.fn()
		const { container } = render(
			createElement(
				numberRenderer,
				baseProps<number | undefined>({
					field: { blockType: 'number', name: 'n', label: 'N' },
					value: 5,
					onChange,
				})
			)
		)
		const input = within(container).getByRole('spinbutton')
		fireEvent.change(input, { target: { value: '42' } })
		expect(onChange).toHaveBeenCalledWith(42)
		fireEvent.change(input, { target: { value: '' } })
		expect(onChange).toHaveBeenCalledWith(undefined)
	})

	it('select: renders options and emits the chosen value', () => {
		const onChange = vi.fn()
		const { container } = render(
			createElement(
				selectRenderer,
				baseProps<string>({
					field: {
						blockType: 'select',
						name: 's',
						label: 'S',
						options: [
							{ label: 'A', value: 'a' },
							{ label: 'B', value: 'b' },
						],
					},
					onChange,
				})
			)
		)
		const select = within(container).getByRole('combobox')
		fireEvent.change(select, { target: { value: 'b' } })
		expect(onChange).toHaveBeenCalledWith('b')
	})

	it('date: renders a date-typed input and fires onChange', () => {
		const onChange = vi.fn()
		const { container } = render(
			createElement(
				dateRenderer,
				baseProps<string>({
					field: { blockType: 'date', name: 'd', label: 'D' },
					value: '2024-01-15',
					onChange,
				})
			)
		)
		const input = container.querySelector('input[type="date"]')
		expect(input).toHaveValue('2024-01-15')
		fireEvent.change(input as HTMLInputElement, { target: { value: '2024-02-01' } })
		expect(onChange).toHaveBeenCalledWith('2024-02-01')
	})

	it('checkbox: emits a boolean', () => {
		const onChange = vi.fn()
		const { container } = render(
			createElement(
				checkboxRenderer,
				baseProps<boolean>({
					field: { blockType: 'checkbox', name: 'c', label: 'C' },
					value: false,
					onChange,
				})
			)
		)
		fireEvent.click(within(container).getByRole('checkbox'))
		expect(onChange).toHaveBeenCalledWith(true)
	})
})
