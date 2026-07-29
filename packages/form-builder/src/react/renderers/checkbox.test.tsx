import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { createElement } from 'react'
import { afterEach, describe, expect, it } from 'vitest'
import type { FieldRendererProps } from '../contract'
import { checkboxRenderer } from './checkbox'

afterEach(() => {
	cleanup()
})

const props = (overrides: Partial<FieldRendererProps<boolean>>): FieldRendererProps<boolean> => ({
	field: { blockType: 'checkbox', name: 'subscribe', label: 'Subscribe' },
	id: 'x',
	name: 'subscribe',
	value: undefined,
	onChange: () => {},
	onBlur: () => {},
	errors: [],
	required: false,
	locale: 'en',
	t: (key) => key,
	...overrides,
})

describe('checkbox renderer', () => {
	it('renders a plain checkbox when display is absent', () => {
		render(createElement(checkboxRenderer, props({})))
		const checkbox = screen.getByRole('checkbox', { name: 'Subscribe' })
		expect(checkbox).not.toHaveAttribute('role', 'switch')
		expect(checkbox).not.toHaveClass('fb-switch')
	})

	it('renders a plain checkbox when display is "checkbox"', () => {
		render(
			createElement(
				checkboxRenderer,
				props({
					field: {
						blockType: 'checkbox',
						name: 'subscribe',
						label: 'Subscribe',
						display: 'checkbox',
					},
				})
			)
		)
		const checkbox = screen.getByRole('checkbox', { name: 'Subscribe' })
		expect(checkbox).not.toHaveAttribute('role', 'switch')
	})
})

describe('checkbox renderer switch display', () => {
	const switchProps = (overrides: Partial<FieldRendererProps<boolean>> = {}) =>
		props({
			field: { blockType: 'checkbox', name: 'subscribe', label: 'Subscribe', display: 'switch' },
			...overrides,
		})

	it('renders the input with role="switch" and a switch modifier class', () => {
		render(createElement(checkboxRenderer, switchProps()))
		const control = screen.getByRole('switch', { name: 'Subscribe' })
		expect(control).toHaveClass('fb-switch')
	})

	it('remains labelled with the field label as its accessible name', () => {
		render(createElement(checkboxRenderer, switchProps()))
		expect(screen.getByRole('switch')).toHaveAccessibleName('Subscribe')
	})

	it('toggling calls onChange with the boolean value', () => {
		let received: boolean | undefined
		render(
			createElement(checkboxRenderer, switchProps({ onChange: (value) => (received = value) }))
		)
		fireEvent.click(screen.getByRole('switch'))
		expect(received).toBe(true)
	})

	it('reflects the checked state from value', () => {
		render(createElement(checkboxRenderer, switchProps({ value: true })))
		expect(screen.getByRole('switch')).toBeChecked()
	})

	it('sets aria-invalid on the input when errors exist', () => {
		render(createElement(checkboxRenderer, switchProps({ errors: ['Required'] })))
		expect(screen.getByRole('switch')).toHaveAttribute('aria-invalid', 'true')
	})

	it('omits aria-invalid on the input when there are no errors', () => {
		render(createElement(checkboxRenderer, switchProps()))
		expect(screen.getByRole('switch')).not.toHaveAttribute('aria-invalid')
	})
})
