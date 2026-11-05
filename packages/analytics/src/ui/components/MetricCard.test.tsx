import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { renderToString } from 'react-dom/server'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Card } from './Card'
import { MetricCard } from './MetricCard'

afterEach(() => {
	cleanup()
})

describe('MetricCard', () => {
	it('is a plain figure, label over value, without a select action', () => {
		const { container } = render(
			<MetricCard className="analytics-panel__card" label="Visitors" value="1,204">
				<span>+4%</span>
			</MetricCard>
		)
		const card = container.firstElementChild
		expect(card?.tagName).toBe('DIV')
		expect(card?.className).toBe('analytics-metric analytics-panel__card')
		expect([...(card?.children ?? [])].map((child) => child.textContent)).toEqual([
			'Visitors',
			'1,204',
			'+4%',
		])
		expect(screen.queryByRole('button')).toBeNull()
	})

	it('is a toggle button in card chrome when it selects what is charted', () => {
		const onSelect = vi.fn()
		render(<MetricCard label="Pageviews" onSelect={onSelect} pressed value="12" />)
		const button = screen.getByRole('button', { name: /Pageviews/ })
		expect(button.getAttribute('aria-pressed')).toBe('true')
		expect(button.classList.contains('analytics-card')).toBe(true)
		fireEvent.click(button)
		expect(onSelect).toHaveBeenCalledTimes(1)
	})

	it('renders on the server, as the stat field does', () => {
		expect(renderToString(<MetricCard label="Views" value="3" />)).toContain(
			'<span class="analytics-metric__value">3</span>'
		)
	})
})

describe('Card', () => {
	it('draws the shared card chrome as a div or a named section', () => {
		const { container } = render(
			<Card aria-labelledby="t" as="section" className="analytics-view__panel">
				<h2 id="t">Trend</h2>
			</Card>
		)
		const section = container.firstElementChild
		expect(section?.tagName).toBe('SECTION')
		expect(section?.className).toBe('analytics-card analytics-view__panel')
		expect(screen.getByRole('region', { name: 'Trend' })).toBeDefined()
	})
})
