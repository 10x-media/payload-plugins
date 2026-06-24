import { cleanup, fireEvent, render, within } from '@testing-library/react'
import { createElement } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { FieldRendererProps } from '../contract'
import { consentRenderer } from './consent'

afterEach(() => {
	cleanup()
})

const props = (overrides: Partial<FieldRendererProps<boolean>>): FieldRendererProps<boolean> => ({
	field: {
		blockType: 'consent',
		name: 'terms',
		statement: 'I agree to the terms',
		sourceConfig: { label: 'Privacy Policy', url: 'https://example.com/privacy' },
	},
	id: 'x',
	name: 'terms',
	value: undefined,
	onChange: () => {},
	onBlur: () => {},
	errors: [],
	required: true,
	locale: 'en',
	t: (key) => key,
	...overrides,
})

describe('consent renderer', () => {
	it('renders unchecked by default when value is undefined', () => {
		const { container } = render(createElement(consentRenderer, props({})))
		const checkbox = within(container).getByRole('checkbox')
		expect(checkbox).not.toBeChecked()
	})

	it('renders the consent statement as the label', () => {
		const { container } = render(createElement(consentRenderer, props({})))
		expect(within(container).getByText('I agree to the terms')).toBeInTheDocument()
	})

	it('renders the policy link from sourceConfig with correct href', () => {
		const { container } = render(createElement(consentRenderer, props({})))
		const link = within(container).getByRole('link', { name: 'Privacy Policy' })
		expect(link).toHaveAttribute('href', 'https://example.com/privacy')
		expect(link).toHaveAttribute('target', '_blank')
		expect(link).toHaveAttribute('rel', 'noopener noreferrer')
	})

	it('calls onChange(true) when toggled from unchecked', () => {
		const onChange = vi.fn()
		const { container } = render(createElement(consentRenderer, props({ value: false, onChange })))
		fireEvent.click(within(container).getByRole('checkbox'))
		expect(onChange).toHaveBeenCalledWith(true)
	})

	it('calls onChange(false) when toggled from checked', () => {
		const onChange = vi.fn()
		const { container } = render(createElement(consentRenderer, props({ value: true, onChange })))
		fireEvent.click(within(container).getByRole('checkbox'))
		expect(onChange).toHaveBeenCalledWith(false)
	})

	it('prefers consentLinks over sourceConfig when both present', () => {
		const { container } = render(
			createElement(
				consentRenderer,
				props({
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
		const link = within(container).getByRole('link', { name: 'Terms of Service' })
		expect(link).toHaveAttribute('href', 'https://example.com/tos')
	})

	it('shows no link when sourceConfig has no url', () => {
		const { container } = render(
			createElement(
				consentRenderer,
				props({
					field: {
						blockType: 'consent',
						name: 'terms',
						statement: 'I agree',
					},
				})
			)
		)
		expect(within(container).queryByRole('link')).toBeNull()
	})

	it('marks the checkbox aria-invalid when errors are present', () => {
		const { container } = render(
			createElement(consentRenderer, props({ errors: ['You must agree'] }))
		)
		expect(within(container).getByRole('checkbox')).toHaveAttribute('aria-invalid', 'true')
	})
})
