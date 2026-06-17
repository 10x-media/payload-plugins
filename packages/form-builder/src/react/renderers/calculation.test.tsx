import { cleanup, render, within } from '@testing-library/react'
import { createElement } from 'react'
import { afterEach, describe, expect, it } from 'vitest'
import type { FieldRendererProps } from '../contract'
import { calculationRenderer } from './calculation'

afterEach(() => {
	cleanup()
})

const props = (
	overrides: Partial<FieldRendererProps<number | undefined>>
): FieldRendererProps<number | undefined> => ({
	field: { blockType: 'calculation', name: 'total', label: 'Total' },
	id: 'x',
	name: 'total',
	value: undefined,
	onChange: () => {},
	onBlur: () => {},
	errors: [],
	required: false,
	locale: 'en',
	t: (key) => key,
	...overrides,
})

describe('calculation renderer', () => {
	it('shows the value read-only, not as an editable control', () => {
		const { container } = render(createElement(calculationRenderer, props({ value: 42 })))
		expect(within(container).getByText('42')).toBeInTheDocument()
		expect(within(container).queryByRole('textbox')).toBeNull()
		expect(within(container).queryByRole('spinbutton')).toBeNull()
	})

	it('renders the label via the field shell', () => {
		const { container } = render(createElement(calculationRenderer, props({ value: 7 })))
		expect(within(container).getByText('Total')).toBeInTheDocument()
	})

	it('renders empty for a nullish value', () => {
		const { container } = render(createElement(calculationRenderer, props({ value: undefined })))
		const output = container.querySelector('output')
		expect(output).not.toBeNull()
		expect(output?.textContent).toBe('')
	})
})
