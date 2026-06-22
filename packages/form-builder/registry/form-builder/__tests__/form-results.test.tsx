import type { FieldAggregation } from '@10x-media/form-builder/react'
import { cleanup, render, within } from '@testing-library/react'
import { createElement } from 'react'
import { afterEach, describe, expect, it } from 'vitest'
import { FormResults } from '../form-results'

afterEach(() => {
	cleanup()
})

const agg: FieldAggregation = {
	field: 'colour',
	label: 'Favourite colour',
	fieldType: 'select',
	total: 3,
	truncated: false,
	buckets: [
		{ value: 'red', label: 'Red', count: 2, percentage: 66.7 },
		{ value: 'blue', label: 'Blue', count: 1, percentage: 33.3 },
	],
}

describe('shadcn FormResults', () => {
	it('renders option labels and percentages', () => {
		const { container } = render(createElement(FormResults, { results: agg }))
		const scope = within(container)
		expect(scope.getByText('Favourite colour')).toBeInTheDocument()
		expect(scope.getByText('Red')).toBeInTheDocument()
		expect(scope.getByText('66.7%')).toBeInTheDocument()
	})

	it('sizes the bar by percentage', () => {
		const { container } = render(createElement(FormResults, { results: agg }))
		const fill = container.querySelector('[data-fb-results-fill]') as HTMLElement | null
		expect(fill?.style.width).toBe('66.7%')
	})

	it('shows the empty state for zero responses', () => {
		const empty: FieldAggregation = { ...agg, total: 0, buckets: [] }
		const { container } = render(createElement(FormResults, { results: empty, t: (k) => k }))
		expect(within(container).getByText('No responses yet')).toBeInTheDocument()
	})

	it('notes a sampled total only when truncated', () => {
		const plain = render(createElement(FormResults, { results: agg }))
		expect(plain.container.textContent).not.toContain('(sample)')
		cleanup()
		const sampled = render(createElement(FormResults, { results: { ...agg, truncated: true } }))
		expect(sampled.container.textContent).toContain('(sample)')
	})
})
