import { cleanup, fireEvent, render, within } from '@testing-library/react'
import { createElement } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { FieldRendererProps } from '../contract'
import { consentRenderer } from './consent'

afterEach(() => {
	cleanup()
})

const richStatementWithLink = {
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

const scriptStatement = {
	root: {
		type: 'root',
		children: [
			{ type: 'paragraph', children: [{ type: 'text', text: '<script>alert(1)</script>' }] },
		],
	},
}

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

	it('renders a legacy string statement as text', () => {
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

	it('renders a rich text statement, including an inline link, as HTML next to the checkbox', () => {
		const { container } = render(
			createElement(
				consentRenderer,
				props({
					field: { blockType: 'consent', name: 'terms', statement: richStatementWithLink },
				})
			)
		)
		const link = within(container).getByRole('link', { name: 'Privacy Policy' })
		expect(link).toHaveAttribute('href', 'https://example.com/privacy')
		expect(within(container).getByText(/I agree to the/)).toBeInTheDocument()
	})

	it('escapes a script injection attempt inside a rich text statement', () => {
		const { container } = render(
			createElement(
				consentRenderer,
				props({
					field: { blockType: 'consent', name: 'terms', statement: scriptStatement },
				})
			)
		)
		expect(container.querySelector('script')).toBeNull()
		expect(within(container).getByText('<script>alert(1)</script>')).toBeInTheDocument()
	})

	it('never renders a legacy string statement as HTML, even when it looks like markup', () => {
		const { container } = render(
			createElement(
				consentRenderer,
				props({
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
	})

	it('renders a block-level statement in a div and space-joins its aria-label', () => {
		const statement = {
			root: {
				type: 'root',
				children: [
					{ type: 'heading', tag: 'h2', children: [{ type: 'text', text: 'Important Terms' }] },
					{
						type: 'list',
						tag: 'ul',
						children: [
							{ type: 'listitem', children: [{ type: 'text', text: 'Option A' }] },
							{ type: 'listitem', children: [{ type: 'text', text: 'Option B' }] },
						],
					},
				],
			},
		}
		const { container } = render(
			createElement(
				consentRenderer,
				props({ field: { blockType: 'consent', name: 'terms', statement } })
			)
		)
		const wrapper = container.querySelector('div.fb-consent__statement')
		expect(wrapper).not.toBeNull()
		expect(wrapper?.querySelector('h2')?.textContent).toBe('Important Terms')
		expect(wrapper?.querySelectorAll('li')).toHaveLength(2)
		expect(within(container).getByRole('checkbox')).toHaveAttribute(
			'aria-label',
			'Important Terms Option A Option B'
		)
	})

	it('renders a malformed lexical-looking statement safely as empty', () => {
		const { container } = render(
			createElement(
				consentRenderer,
				props({ field: { blockType: 'consent', name: 'terms', statement: { root: {} } } })
			)
		)
		expect(container.querySelector('.fb-consent__statement')).toBeNull()
		const checkbox = within(container).getByRole('checkbox')
		expect(checkbox).not.toHaveAttribute('aria-label')
		expect(checkbox).not.toBeChecked()
	})

	it('sets the checkbox aria-label to the flattened plain text of a rich text statement', () => {
		const { container } = render(
			createElement(
				consentRenderer,
				props({
					field: { blockType: 'consent', name: 'terms', statement: richStatementWithLink },
				})
			)
		)
		expect(within(container).getByRole('checkbox')).toHaveAttribute(
			'aria-label',
			'I agree to the Privacy Policy.'
		)
	})

	it('sets the checkbox aria-label to the legacy string statement', () => {
		const { container } = render(createElement(consentRenderer, props({})))
		expect(within(container).getByRole('checkbox')).toHaveAttribute(
			'aria-label',
			'I agree to the terms'
		)
	})

	it('falls back to field.label for the aria-label when statement is absent', () => {
		const { container } = render(
			createElement(
				consentRenderer,
				props({
					field: { blockType: 'consent', name: 'terms', label: 'Accept the rules' },
				})
			)
		)
		expect(within(container).getByRole('checkbox')).toHaveAttribute(
			'aria-label',
			'Accept the rules'
		)
	})

	it('does not render a dangling required marker when there is no statement or label', () => {
		const { container } = render(
			createElement(
				consentRenderer,
				props({
					field: { blockType: 'consent', name: 'terms' },
					required: true,
				})
			)
		)
		expect(container.querySelector('.fb-field__required')).toBeNull()
	})
})
