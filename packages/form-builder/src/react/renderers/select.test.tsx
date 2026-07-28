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
		expect(within(container).getByText('Free')).toBeInTheDocument()
	})

	it('falls back to the value as the visible label when no label was authored', () => {
		const { container } = render(
			createElement(
				selectRenderer,
				props({ field: { blockType: 'select', name: 'plan', options: [{ value: 'a' }] } })
			)
		)
		expect(within(container).getByText('a')).toBeInTheDocument()
	})
})
