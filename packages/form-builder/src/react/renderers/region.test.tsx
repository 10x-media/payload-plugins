import { cleanup, fireEvent, render, within } from '@testing-library/react'
import { createElement } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { FieldRendererProps } from '../contract'
import { countryRenderer, stateRenderer } from './region'

afterEach(() => {
	cleanup()
})

const baseProps = (overrides: Partial<FieldRendererProps<string>>): FieldRendererProps<string> => ({
	field: { blockType: 'country', name: 'f', label: 'Field' },
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

describe('region field renderers', () => {
	it('country: renders the fixed country set and emits the chosen code', () => {
		const onChange = vi.fn()
		const { container } = render(
			createElement(
				countryRenderer,
				baseProps({ field: { blockType: 'country', name: 'c', label: 'Country' }, onChange })
			)
		)
		const select = within(container).getByRole('combobox')
		expect(within(select).getByRole('option', { name: 'Germany' })).toHaveValue('DE')
		fireEvent.change(select, { target: { value: 'DE' } })
		expect(onChange).toHaveBeenCalledWith('DE')
	})

	it('state: renders the fixed US state set and emits the chosen code', () => {
		const onChange = vi.fn()
		const { container } = render(
			createElement(
				stateRenderer,
				baseProps({ field: { blockType: 'state', name: 's', label: 'State' }, onChange })
			)
		)
		const select = within(container).getByRole('combobox')
		expect(within(select).getByRole('option', { name: 'California' })).toHaveValue('CA')
		fireEvent.change(select, { target: { value: 'CA' } })
		expect(onChange).toHaveBeenCalledWith('CA')
	})

	it('ignores any author-supplied options on the instance', () => {
		const { container } = render(
			createElement(
				countryRenderer,
				baseProps({
					field: {
						blockType: 'country',
						name: 'c',
						label: 'Country',
						options: [{ label: 'Bogus', value: 'zz' }],
					},
				})
			)
		)
		const select = within(container).getByRole('combobox')
		expect(within(select).queryByRole('option', { name: 'Bogus' })).toBeNull()
		expect(within(select).getByRole('option', { name: 'United States of America' })).toHaveValue(
			'US'
		)
	})
})
