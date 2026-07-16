import { type FieldRendererProps, Form } from '@10x-media/form-builder/react'
import { cleanup, fireEvent, render, within } from '@testing-library/react'
import { createElement } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { calculationField } from '../fields/calculation-field'
import { checkboxField } from '../fields/checkbox-field'
import { consentField } from '../fields/consent-field'
import { dateField } from '../fields/date-field'
import { emailField } from '../fields/email-field'
import { messageField } from '../fields/message-field'
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

	it('date: input type is date', () => {
		const { container } = render(
			createElement(
				dateField,
				baseProps<string>({ field: { blockType: 'date', name: 'd', label: 'D' } })
			)
		)
		const input = container.querySelector('input')
		expect(input).toHaveAttribute('type', 'date')
	})

	it('consent: labels the checkbox with the statement, links to the policy, and emits a boolean', () => {
		const onChange = vi.fn()
		const { container } = render(
			createElement(
				consentField,
				baseProps<boolean>({
					field: {
						blockType: 'consent',
						name: 'terms',
						statement: 'I agree to the terms',
						sourceConfig: { label: 'Privacy Policy', url: 'https://example.com/privacy' },
					},
					value: false,
					onChange,
				})
			)
		)
		const checkbox = within(container).getByRole('checkbox')
		expect(within(container).getByText('I agree to the terms')).toBeInTheDocument()
		const link = within(container).getByRole('link', { name: 'Privacy Policy' })
		expect(link).toHaveAttribute('href', 'https://example.com/privacy')
		fireEvent.click(checkbox)
		expect(onChange).toHaveBeenCalledWith(true)
	})

	it('consent: prefers consentLinks over sourceConfig when both are present', () => {
		const { container } = render(
			createElement(
				consentField,
				baseProps<boolean>({
					field: {
						blockType: 'consent',
						name: 'terms',
						statement: 'I agree',
						sourceConfig: { label: 'Fallback', url: 'https://example.com/fallback' },
						consentLinks: [{ label: 'Terms of Service', url: 'https://example.com/tos' }],
					},
				})
			)
		)
		expect(within(container).queryByRole('link', { name: 'Fallback' })).toBeNull()
		expect(within(container).getByRole('link', { name: 'Terms of Service' })).toHaveAttribute(
			'href',
			'https://example.com/tos'
		)
	})

	it('consent: renders a rich text statement with an inline link and a plain-text aria-label', () => {
		const statement = {
			root: {
				type: 'root',
				children: [
					{
						type: 'paragraph',
						children: [
							{ type: 'text', text: 'I agree to the ' },
							{
								type: 'link',
								fields: { url: 'https://example.com/privacy', newTab: true },
								children: [{ type: 'text', text: 'Privacy Policy' }],
							},
							{ type: 'text', text: '.' },
						],
					},
				],
			},
		}
		const { container } = render(
			createElement(
				consentField,
				baseProps<boolean>({
					field: { blockType: 'consent', name: 'terms', statement },
				})
			)
		)
		const link = within(container).getByRole('link', { name: 'Privacy Policy' })
		expect(link).toHaveAttribute('href', 'https://example.com/privacy')
		expect(within(container).getByRole('checkbox')).toHaveAttribute(
			'aria-label',
			'I agree to the Privacy Policy.'
		)
	})

	it('consent: escapes a script injection attempt inside a rich text statement', () => {
		const statement = {
			root: {
				type: 'root',
				children: [
					{ type: 'paragraph', children: [{ type: 'text', text: '<script>alert(1)</script>' }] },
				],
			},
		}
		const { container } = render(
			createElement(
				consentField,
				baseProps<boolean>({
					field: { blockType: 'consent', name: 'terms', statement },
				})
			)
		)
		expect(container.querySelector('script')).toBeNull()
		expect(within(container).getByText('<script>alert(1)</script>')).toBeInTheDocument()
	})

	it('consent: never renders a legacy string statement as HTML, even when it looks like markup', () => {
		const { container } = render(
			createElement(
				consentField,
				baseProps<boolean>({
					field: {
						blockType: 'consent',
						name: 'terms',
						statement: '<b>Bold</b> and <script>alert(1)</script>',
					},
				})
			)
		)
		expect(container.querySelector('script')).toBeNull()
		expect(container.querySelector('b')).toBeNull()
		expect(
			within(container).getByText('<b>Bold</b> and <script>alert(1)</script>')
		).toBeInTheDocument()
		expect(within(container).getByRole('checkbox')).toHaveAttribute(
			'aria-label',
			'<b>Bold</b> and <script>alert(1)</script>'
		)
	})

	it('calculation: renders the computed value read-only, never editable', () => {
		const { container } = render(
			createElement(
				calculationField,
				baseProps<number | undefined>({
					field: { blockType: 'calculation', name: 'total', label: 'Total' },
					value: 42,
				})
			)
		)
		expect(within(container).getByText('42')).toBeInTheDocument()
		expect(container.querySelector('input')).toBeNull()
	})

	it('message: renders serialized rich text inline within a form', () => {
		const content = {
			root: {
				type: 'root',
				children: [{ type: 'paragraph', children: [{ type: 'text', text: 'Read me' }] }],
			},
		}
		const { container } = render(
			<Form
				form={{ id: 1, fields: [{ blockType: 'message', name: 'note', content }] }}
				onSubmit={vi.fn()}
				renderers={{ message: messageField }}
			/>
		)
		expect(within(container).getByText('Read me')).toBeInTheDocument()
	})

	it('message: interpolates recall tokens against calc-authoritative values', () => {
		const content = {
			root: {
				type: 'root',
				children: [{ type: 'paragraph', children: [{ type: 'text', text: 'Total: {{total}}' }] }],
			},
		}
		const { container } = render(
			<Form
				form={{
					id: 1,
					fields: [
						{ blockType: 'number', name: 'score', label: 'Score' },
						{
							blockType: 'calculation',
							name: 'total',
							expression: {
								type: 'op',
								op: '*',
								left: { type: 'ref', field: 'score' },
								right: { type: 'lit', value: 2 },
							},
						},
						{ blockType: 'message', name: 'note', content },
					],
				}}
				onSubmit={vi.fn()}
				renderers={{ message: messageField }}
			/>
		)
		fireEvent.change(within(container).getByLabelText('Score'), { target: { value: '21' } })
		expect(within(container).getByText('Total: 42')).toBeInTheDocument()
	})
})
