import { cleanup, render, within } from '@testing-library/react'
import { createElement } from 'react'
import { afterEach, describe, expect, it } from 'vitest'
import type { FieldAggregation } from '../aggregation/types'
import { FormResults } from './FormResults'

afterEach(() => {
	cleanup()
})

const agg = (over: Partial<FieldAggregation> = {}): FieldAggregation => ({
	field: 'colour',
	label: 'Favourite colour',
	fieldType: 'select',
	total: 3,
	truncated: false,
	buckets: [
		{ value: 'red', label: 'Red', count: 2, percentage: 66.7 },
		{ value: 'blue', label: 'Blue', count: 1, percentage: 33.3 },
		{ value: 'green', label: 'Green', count: 0, percentage: 0 },
	],
	...over,
})

describe('FormResults', () => {
	it('renders each option label, count, and percentage as text', () => {
		const { container } = render(createElement(FormResults, { results: agg() }))
		const scope = within(container)
		expect(scope.getByText('Favourite colour')).toBeInTheDocument()
		expect(scope.getByText('Red')).toBeInTheDocument()
		expect(scope.getByText('66.7%')).toBeInTheDocument()
		expect(scope.getByText('33.3%')).toBeInTheDocument()
	})

	it('renders a decorative bar whose width tracks the percentage and is aria-hidden', () => {
		const { container } = render(createElement(FormResults, { results: agg() }))
		const bar = container.querySelector('.fb-results__bar-fill') as HTMLElement | null
		expect(bar).not.toBeNull()
		expect(bar?.style.width).toBe('66.7%')
		expect(bar?.getAttribute('aria-hidden')).toBe('true')
	})

	it('shows the respondent total', () => {
		const { container } = render(createElement(FormResults, { results: agg() }))
		const total = container.querySelector('.fb-results__total')
		expect(total).not.toBeNull()
		expect(total?.textContent).toMatch(/3/)
	})

	it('shows the empty state when there are no responses', () => {
		const { container } = render(
			createElement(FormResults, { results: agg({ total: 0, buckets: [] }), t: (k) => k })
		)
		expect(within(container).getByText('formBuilder:results.noResponses')).toBeInTheDocument()
	})

	it('renders multiple field aggregations when given an array', () => {
		const second = agg({
			field: 'size',
			label: 'Size',
			buckets: [{ value: 's', label: 'Small', count: 3, percentage: 100 }],
		})
		const { container } = render(createElement(FormResults, { results: [agg(), second] }))
		expect(within(container).getByText('Favourite colour')).toBeInTheDocument()
		expect(within(container).getByText('Size')).toBeInTheDocument()
	})

	it('uses the translator for built-in copy and the field label from data', () => {
		const { container } = render(createElement(FormResults, { results: agg(), t: (k) => `T:${k}` }))
		expect(within(container).getByText('Favourite colour')).toBeInTheDocument()
		expect(within(container).getByText(/T:formBuilder:results.responses/)).toBeInTheDocument()
	})

	it('omits the per-option count when showCounts is false', () => {
		const { container } = render(createElement(FormResults, { results: agg(), showCounts: false }))
		expect(container.querySelector('.fb-results__count')).toBeNull()
		expect(within(container).getByText('66.7%')).toBeInTheDocument()
	})

	it('highlights the winning bucket with class and a translated badge', () => {
		const { container } = render(
			createElement(FormResults, { results: agg(), winningValue: 'red', t: (k) => k })
		)
		const winner = container.querySelector('.fb-results__bucket--winner')
		expect(winner).not.toBeNull()
		expect(winner?.textContent).toContain('Red')
		expect(winner?.querySelector('.fb-results__winner-badge')?.textContent).toBe(
			'formBuilder:results.winner'
		)
		expect(container.querySelectorAll('.fb-results__bucket--winner')).toHaveLength(1)
	})

	it('marks no winner without a winningValue or when it matches no bucket', () => {
		const plain = render(createElement(FormResults, { results: agg() }))
		expect(plain.container.querySelector('.fb-results__bucket--winner')).toBeNull()
		cleanup()
		const unmatched = render(createElement(FormResults, { results: agg(), winningValue: 'purple' }))
		expect(unmatched.container.querySelector('.fb-results__bucket--winner')).toBeNull()
	})

	it('appends the sample note only when the aggregation is truncated', () => {
		const plain = render(createElement(FormResults, { results: agg(), t: (k) => k }))
		expect(plain.container.querySelector('.fb-results__total')?.textContent).not.toContain(
			'formBuilder:results.truncated'
		)
		cleanup()
		const sampled = render(
			createElement(FormResults, { results: agg({ truncated: true }), t: (k) => k })
		)
		expect(sampled.container.querySelector('.fb-results__total')?.textContent).toContain(
			'formBuilder:results.truncated'
		)
	})
})
