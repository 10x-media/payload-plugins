import { cleanup, render, screen } from '@testing-library/react'
import { createElement } from 'react'
import { afterEach, describe, expect, it } from 'vitest'
import type { FieldRendererProps } from '../contract'
import { textRenderer } from './text'

afterEach(() => {
	cleanup()
})

const props = (overrides: Partial<FieldRendererProps<string>>): FieldRendererProps<string> => ({
	field: { blockType: 'text', name: 'given-name', label: 'Name' },
	id: 'x',
	name: 'given-name',
	value: undefined,
	onChange: () => {},
	onBlur: () => {},
	errors: [],
	required: false,
	locale: 'en',
	t: (key) => key,
	...overrides,
})

describe('text renderer', () => {
	it('forwards field.autocomplete to the input autocomplete attribute', () => {
		render(
			createElement(
				textRenderer,
				props({
					field: {
						blockType: 'text',
						name: 'given-name',
						label: 'Name',
						autocomplete: 'given-name',
					},
				})
			)
		)
		expect(screen.getByLabelText('Name')).toHaveAttribute('autocomplete', 'given-name')
	})

	it('omits the autocomplete attribute when field.autocomplete is absent', () => {
		render(createElement(textRenderer, props({})))
		expect(screen.getByLabelText('Name')).not.toHaveAttribute('autocomplete')
	})

	it('omits the autocomplete attribute when field.autocomplete is blank', () => {
		render(
			createElement(
				textRenderer,
				props({
					field: { blockType: 'text', name: 'given-name', label: 'Name', autocomplete: '  ' },
				})
			)
		)
		expect(screen.getByLabelText('Name')).not.toHaveAttribute('autocomplete')
	})
})
