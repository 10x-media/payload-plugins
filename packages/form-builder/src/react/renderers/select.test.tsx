import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { createElement } from 'react'
import { afterEach, describe, expect, it } from 'vitest'
import type { FieldRendererProps } from '../contract'
import { selectRenderer } from './select'

afterEach(() => {
	cleanup()
})

const props = (overrides: Partial<FieldRendererProps<string>>): FieldRendererProps<string> => ({
	field: { blockType: 'select', name: 'plan', label: 'Plan', options: [] },
	id: 'x',
	name: 'plan',
	value: undefined,
	onChange: () => {},
	onBlur: () => {},
	errors: [],
	required: false,
	locale: 'en',
	t: (key) => key,
	...overrides,
})

describe('select renderer', () => {
	it('renders an authored label for an option that has one', () => {
		const { container } = render(
			createElement(
				selectRenderer,
				props({
					field: { blockType: 'select', name: 'plan', options: [{ label: 'Free', value: 'free' }] },
				})
			)
		)
		const select = within(container).getByRole('combobox')
		expect(within(select).getByRole('option', { name: 'Free' })).toHaveValue('free')
	})

	it('falls back to the value as the visible label when no label was authored', () => {
		const { container } = render(
			createElement(
				selectRenderer,
				props({ field: { blockType: 'select', name: 'plan', options: [{ value: 'a' }] } })
			)
		)
		const select = within(container).getByRole('combobox')
		expect(within(select).getByRole('option', { name: 'a' })).toHaveValue('a')
	})

	it('falls back to the value when the authored label is blank', () => {
		const { container } = render(
			createElement(
				selectRenderer,
				props({
					field: { blockType: 'select', name: 'plan', options: [{ label: '', value: 'b' }] },
				})
			)
		)
		const select = within(container).getByRole('combobox')
		expect(within(select).getByRole('option', { name: 'b' })).toHaveValue('b')
	})

	it('keeps the dropdown when display is absent', () => {
		render(
			createElement(
				selectRenderer,
				props({
					field: { blockType: 'select', name: 'plan', options: [{ label: 'Free', value: 'free' }] },
				})
			)
		)
		expect(screen.getByRole('combobox')).toBeInTheDocument()
		expect(screen.queryByRole('radiogroup')).not.toBeInTheDocument()
	})

	it('keeps the dropdown when display is "dropdown"', () => {
		render(
			createElement(
				selectRenderer,
				props({
					field: {
						blockType: 'select',
						name: 'plan',
						display: 'dropdown',
						options: [{ label: 'Free', value: 'free' }],
					},
				})
			)
		)
		expect(screen.getByRole('combobox')).toBeInTheDocument()
		expect(screen.queryByRole('radiogroup')).not.toBeInTheDocument()
	})
})

describe('select renderer radio display', () => {
	const radioProps = (overrides: Partial<FieldRendererProps<string>> = {}) =>
		props({
			field: {
				blockType: 'select',
				name: 'plan',
				label: 'Plan',
				display: 'radio',
				options: [
					{ label: 'Free', value: 'free' },
					{ label: '', value: 'blank' },
					{ value: 'nolabel' },
				],
			},
			...overrides,
		})

	it('renders a radiogroup with one labelled radio per option', () => {
		render(createElement(selectRenderer, radioProps()))
		const group = screen.getByRole('radiogroup')
		const radios = within(group).getAllByRole('radio')
		expect(radios).toHaveLength(3)
		expect(within(group).getByRole('radio', { name: 'Free' })).toBeInTheDocument()
		expect(within(group).getByRole('radio', { name: 'blank' })).toBeInTheDocument()
		expect(within(group).getByRole('radio', { name: 'nolabel' })).toBeInTheDocument()
	})

	it('associates the radiogroup with the field label and description', () => {
		render(
			createElement(
				selectRenderer,
				radioProps({
					field: {
						blockType: 'select',
						name: 'plan',
						label: 'Plan',
						display: 'radio',
						description: 'Pick one',
						options: [{ label: 'Free', value: 'free' }],
					},
				})
			)
		)
		const group = screen.getByRole('radiogroup', { name: 'Plan' })
		expect(group).toHaveAccessibleDescription('Pick one')
	})

	it('checks the radio matching the current value', () => {
		render(createElement(selectRenderer, radioProps({ value: 'blank' })))
		expect(screen.getByRole('radio', { name: 'blank' })).toBeChecked()
		expect(screen.getByRole('radio', { name: 'Free' })).not.toBeChecked()
	})

	it('calls onChange with the clicked option value', () => {
		let received: string | undefined
		render(createElement(selectRenderer, radioProps({ onChange: (value) => (received = value) })))
		fireEvent.click(screen.getByRole('radio', { name: 'Free' }))
		expect(received).toBe('free')
	})

	it('does not dangle aria-labelledby when the field has no label', () => {
		render(
			createElement(
				selectRenderer,
				props({
					field: {
						blockType: 'select',
						name: 'plan',
						display: 'radio',
						options: [{ label: 'Free', value: 'free' }],
					},
				})
			)
		)
		expect(screen.getByRole('radiogroup')).not.toHaveAttribute('aria-labelledby')
	})

	it('sets aria-invalid on every radio, not the group, when the field has errors', () => {
		render(createElement(selectRenderer, radioProps({ errors: ['Choose a valid option'] })))
		expect(screen.getByRole('radiogroup')).not.toHaveAttribute('aria-invalid')
		for (const radio of screen.getAllByRole('radio')) {
			expect(radio).toHaveAttribute('aria-invalid', 'true')
		}
	})

	it('omits aria-invalid on the radios when the field has no errors', () => {
		render(createElement(selectRenderer, radioProps()))
		for (const radio of screen.getAllByRole('radio')) {
			expect(radio).not.toHaveAttribute('aria-invalid')
		}
	})

	it('labels the group with a plain span, not a label[for] pointing at a nonexistent id', () => {
		render(createElement(selectRenderer, radioProps()))
		const caption = screen.getByText('Plan')
		expect(caption.tagName).toBe('SPAN')
		expect(caption).not.toHaveAttribute('for')
	})
})

describe('select renderer buttons display', () => {
	it('renders radiogroup semantics styled as buttons', () => {
		const { container } = render(
			createElement(
				selectRenderer,
				props({
					field: {
						blockType: 'select',
						name: 'plan',
						label: 'Plan',
						display: 'buttons',
						options: [
							{ label: 'Free', value: 'free' },
							{ label: 'Pro', value: 'pro' },
						],
					},
				})
			)
		)
		const group = screen.getByRole('radiogroup')
		expect(within(group).getAllByRole('radio')).toHaveLength(2)
		expect(container.querySelector('.fb-choice--buttons')).not.toBeNull()
	})

	it('checks the radio matching the current value and reports onChange', () => {
		let received: string | undefined
		render(
			createElement(
				selectRenderer,
				props({
					field: {
						blockType: 'select',
						name: 'plan',
						display: 'buttons',
						options: [
							{ label: 'Free', value: 'free' },
							{ label: 'Pro', value: 'pro' },
						],
					},
					value: 'pro',
					onChange: (value) => (received = value),
				})
			)
		)
		expect(screen.getByRole('radio', { name: 'Pro' })).toBeChecked()
		fireEvent.click(screen.getByRole('radio', { name: 'Free' }))
		expect(received).toBe('free')
	})

	it('sets aria-invalid on every radio when the field has errors', () => {
		render(
			createElement(
				selectRenderer,
				props({
					field: {
						blockType: 'select',
						name: 'plan',
						display: 'buttons',
						options: [
							{ label: 'Free', value: 'free' },
							{ label: 'Pro', value: 'pro' },
						],
					},
					errors: ['Choose a valid option'],
				})
			)
		)
		for (const radio of screen.getAllByRole('radio')) {
			expect(radio).toHaveAttribute('aria-invalid', 'true')
		}
	})
})
