import { cleanup, render, within } from '@testing-library/react'
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
})
