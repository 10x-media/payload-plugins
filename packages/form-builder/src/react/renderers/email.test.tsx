import { cleanup, render, screen } from '@testing-library/react'
import { createElement } from 'react'
import { afterEach, describe, expect, it } from 'vitest'
import type { FieldRendererProps } from '../contract'
import { emailRenderer } from './email'

afterEach(() => {
	cleanup()
})

const props = (overrides: Partial<FieldRendererProps<string>>): FieldRendererProps<string> => ({
	field: { blockType: 'email', name: 'email', label: 'Email' },
	id: 'x',
	name: 'email',
	value: undefined,
	onChange: () => {},
	onBlur: () => {},
	errors: [],
	required: false,
	locale: 'en',
	t: (key) => key,
	...overrides,
})

describe('email renderer', () => {
	it('forwards field.autocomplete to the input autocomplete attribute', () => {
		render(
			createElement(
				emailRenderer,
				props({
					field: { blockType: 'email', name: 'email', label: 'Email', autocomplete: 'email' },
				})
			)
		)
		expect(screen.getByLabelText('Email')).toHaveAttribute('autocomplete', 'email')
	})

	it('omits the autocomplete attribute when field.autocomplete is absent', () => {
		render(createElement(emailRenderer, props({})))
		expect(screen.getByLabelText('Email')).not.toHaveAttribute('autocomplete')
	})

	it('omits the autocomplete attribute when field.autocomplete is blank', () => {
		render(
			createElement(
				emailRenderer,
				props({ field: { blockType: 'email', name: 'email', label: 'Email', autocomplete: '  ' } })
			)
		)
		expect(screen.getByLabelText('Email')).not.toHaveAttribute('autocomplete')
	})
})
