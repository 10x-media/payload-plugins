import type { FieldRendererProps } from '@10x-media/form-builder/react'
import { cleanup, fireEvent, render, within } from '@testing-library/react'
import { createElement } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { checkboxField } from '../fields/checkbox-field'
import { emailField } from '../fields/email-field'
import { numberField } from '../fields/number-field'
import { selectField } from '../fields/select-field'
import { textField } from '../fields/text-field'
import { textareaField } from '../fields/textarea-field'

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

describe('shadcn field renderers (aliased to native shims)', () => {
	it('text: labels control, shows error alert + aria-invalid, fires onChange', () => {
		const onChange = vi.fn()
		const { container } = render(
			createElement(textField, baseProps<string>({ value: 'hi', onChange, errors: ['Bad'] }))
		)
		const input = within(container).getByRole('textbox')
		expect(input).toHaveValue('hi')
		expect(input).toHaveAttribute('aria-invalid', 'true')
		expect(input).toHaveAttribute('aria-describedby')
		expect(within(container).getByRole('alert')).toHaveTextContent('Bad')
		fireEvent.change(input, { target: { value: 'bye' } })
		expect(onChange).toHaveBeenCalledWith('bye')
	})

	it('text: associates the label with the control', () => {
		const { container } = render(
			createElement(
				textField,
				baseProps<string>({ field: { blockType: 'text', name: 'fn', label: 'First name' } })
			)
		)
		const label = within(container).getByText('First name')
		const input = within(container).getByRole('textbox')
		expect(label).toHaveAttribute('for', input.getAttribute('id'))
	})

	it('email: input type is email', () => {
		const { container } = render(
			createElement(
				emailField,
				baseProps<string>({ field: { blockType: 'email', name: 'e', label: 'E' } })
			)
		)
		expect(within(container).getByRole('textbox')).toHaveAttribute('type', 'email')
	})

	it('textarea: renders a textarea and fires onChange', () => {
		const onChange = vi.fn()
		const { container } = render(
			createElement(
				textareaField,
				baseProps<string>({ field: { blockType: 'textarea', name: 'ta', label: 'TA' }, onChange })
			)
		)
		const ta = within(container).getByRole('textbox')
		expect(ta.tagName).toBe('TEXTAREA')
		fireEvent.change(ta, { target: { value: 'long' } })
		expect(onChange).toHaveBeenCalledWith('long')
	})

	it('number: emits a number and undefined when cleared', () => {
		const onChange = vi.fn()
		const { container } = render(
			createElement(
				numberField,
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
				selectField,
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
		fireEvent.change(within(container).getByRole('combobox'), { target: { value: 'b' } })
		expect(onChange).toHaveBeenCalledWith('b')
	})

	it('checkbox: labels control and emits a boolean', () => {
		const onChange = vi.fn()
		const { container } = render(
			createElement(
				checkboxField,
				baseProps<boolean>({
					field: { blockType: 'checkbox', name: 'c', label: 'Accept' },
					value: false,
					onChange,
				})
			)
		)
		fireEvent.click(within(container).getByRole('checkbox'))
		expect(onChange).toHaveBeenCalledWith(true)
	})
})
