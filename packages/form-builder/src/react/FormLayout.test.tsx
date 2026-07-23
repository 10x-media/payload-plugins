import { cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { FormLayout, widthProps } from './FormLayout'

afterEach(() => {
	cleanup()
})

describe('FormLayout', () => {
	it('applies the grid class when enabled and a width data attribute on a child', () => {
		const { container } = render(
			<FormLayout>
				<div {...widthProps('half')}>x</div>
			</FormLayout>
		)
		expect(container.querySelector('.fb-form--grid')).not.toBeNull()
		expect(container.querySelector('[data-width="half"]')).not.toBeNull()
	})

	it('omits the grid class when disabled', () => {
		const { container } = render(<FormLayout enabled={false}>x</FormLayout>)
		expect(container.querySelector('.fb-form--grid')).toBeNull()
		expect(container.querySelector('.fb-form')).not.toBeNull()
	})

	it('defaults width to full when none given', () => {
		expect(widthProps(undefined)).toEqual({ 'data-width': 'full' })
	})

	it('merges a custom className onto the container', () => {
		const { container } = render(<FormLayout className="my-fields">x</FormLayout>)
		const el = container.querySelector('.fb-form')
		expect(el).toHaveClass('fb-form', 'fb-form--grid', 'my-fields')
	})

	it('merges a custom className when the grid is disabled', () => {
		const { container } = render(
			<FormLayout enabled={false} className="my-fields">
				x
			</FormLayout>
		)
		const el = container.querySelector('.fb-form')
		expect(el).toHaveClass('fb-form', 'my-fields')
		expect(el).not.toHaveClass('fb-form--grid')
	})
})
