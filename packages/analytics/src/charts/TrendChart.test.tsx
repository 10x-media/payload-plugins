import { cleanup, fireEvent, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { TrendChart, type TrendPoint } from './TrendChart'

const point = (label: string, value: number): TrendPoint => ({
	label,
	value,
	display: String(value),
})

const primary = [point('Mon', 4), point('Tue', 8), point('Wed', 2), point('Thu', 6)]
const previous = [point('Mon', 1), point('Tue', 3), point('Wed', 9), point('Thu', 5)]

class ResizeObserverStub {
	observe(): void {}
	unobserve(): void {}
	disconnect(): void {}
}

const sized = (prop: 'clientWidth' | 'clientHeight', value: number): void => {
	Object.defineProperty(HTMLElement.prototype, prop, { configurable: true, value })
}

beforeEach(() => {
	vi.stubGlobal('ResizeObserver', ResizeObserverStub)
	sized('clientWidth', 600)
	sized('clientHeight', 200)
})

afterEach(() => {
	cleanup()
	vi.unstubAllGlobals()
})

// Matches the component's own MARGIN/PAD constants at the stubbed 600x200 box.
const PLOT_H = 200 - 8 - 18
const PAD = 2

describe('TrendChart comparison overlay', () => {
	it('draws a second, muted line when a comparison is given', () => {
		const { container } = render(
			<TrendChart
				ariaLabel="Pageviews"
				buckets={primary}
				comparison={previous}
				comparisonLabel="Previous period"
				label="Pageviews"
			/>
		)
		expect(container.querySelectorAll('path.analytics-chart__line')).toHaveLength(1)
		expect(container.querySelectorAll('path.analytics-chart__comparison')).toHaveLength(1)
		// The comparison never gets its own area fill.
		expect(container.querySelectorAll('path.analytics-chart__area')).toHaveLength(1)
	})

	it('draws one line without a comparison', () => {
		const { container } = render(<TrendChart ariaLabel="Pageviews" buckets={primary} />)
		expect(container.querySelectorAll('path.analytics-chart__line')).toHaveLength(1)
		expect(container.querySelectorAll('path.analytics-chart__comparison')).toHaveLength(0)
	})

	it('renders the legend only with a comparison', () => {
		const { container, rerender } = render(<TrendChart ariaLabel="Pageviews" buckets={primary} />)
		expect(container.querySelector('.analytics-chart__legend')).toBeNull()
		rerender(
			<TrendChart
				ariaLabel="Pageviews"
				buckets={primary}
				comparison={previous}
				comparisonLabel="Previous period"
				label="Pageviews"
			/>
		)
		const legend = container.querySelector('.analytics-chart__legend')
		expect(legend).not.toBeNull()
		expect(legend?.textContent).toContain('Pageviews')
		expect(legend?.textContent).toContain('Previous period')
		expect(container.querySelectorAll('.analytics-chart__legend-swatch')).toHaveLength(2)
	})

	it('names the comparison range in the legend, never in the tooltip', () => {
		const { container } = render(
			<TrendChart
				ariaLabel="Pageviews"
				buckets={primary}
				comparison={previous}
				comparisonLabel="Previous period"
				comparisonRange="Jul 17, 2026 - Aug 15, 2026"
				label="Pageviews"
			/>
		)
		expect(container.querySelector('.analytics-chart__legend-range')?.textContent).toContain(
			'Jul 17, 2026 - Aug 15, 2026'
		)
		const plot = container.querySelector('.analytics-chart__plot')
		if (!plot) {
			throw new Error('no plot')
		}
		fireEvent(plot, new MouseEvent('pointermove', { bubbles: true, clientX: 600 }))
		const tooltip = container.querySelector('.analytics-chart__tooltip')
		expect(tooltip?.textContent).toContain('Previous period')
		expect(tooltip?.textContent).not.toContain('Jul 17, 2026')
	})

	it('shows both values in the tooltip for the hovered bucket', () => {
		const { container } = render(
			<TrendChart
				ariaLabel="Pageviews"
				buckets={primary}
				comparison={previous}
				comparisonLabel="Previous period"
				label="Pageviews"
			/>
		)
		const plot = container.querySelector('.analytics-chart__plot')
		expect(plot).not.toBeNull()
		if (!plot) {
			return
		}
		// jsdom's PointerEvent drops coordinates; a MouseEvent named `pointermove` carries
		// the clientX React reads off the native event.
		fireEvent(plot, new MouseEvent('pointermove', { bubbles: true, clientX: 600 }))
		const tooltip = container.querySelector('.analytics-chart__tooltip')
		expect(tooltip?.textContent).toContain('Thu')
		expect(tooltip?.textContent).toContain('6')
		expect(tooltip?.textContent).toContain('Previous period')
		expect(tooltip?.textContent).toContain('5')
	})

	it('scales the y-axis over both series', () => {
		const { container } = render(
			<TrendChart
				ariaLabel="Pageviews"
				buckets={[point('Mon', 0), point('Tue', 0)]}
				comparison={[point('Mon', 0), point('Tue', 10)]}
				comparisonLabel="Previous period"
				label="Pageviews"
			/>
		)
		const dots = container.querySelectorAll(
			'circle.analytics-chart__dot:not(.analytics-chart__dot--comparison)'
		)
		// A flat primary alone would sit on the midline; against a comparison that peaks at
		// 10 it sits on the floor of the shared scale.
		expect(dots[0]?.getAttribute('cy')).toBe(String(PLOT_H - PAD))
		const comparisonDots = container.querySelectorAll('circle.analytics-chart__dot--comparison')
		expect(comparisonDots[1]?.getAttribute('cy')).toBe(String(PAD))
	})

	it('normalizes a comparison of a different length to the primary axis', () => {
		const { container } = render(
			<TrendChart
				ariaLabel="Pageviews"
				buckets={primary}
				comparison={[point('Mon', 1)]}
				comparisonLabel="Previous period"
				label="Pageviews"
			/>
		)
		expect(container.querySelectorAll('circle.analytics-chart__dot--comparison')).toHaveLength(
			primary.length
		)
	})

	it('truncates a longer comparison to the primary axis', () => {
		const { container } = render(
			<TrendChart
				ariaLabel="Pageviews"
				buckets={[point('Mon', 1), point('Tue', 2)]}
				comparison={previous}
				comparisonLabel="Previous period"
				label="Pageviews"
			/>
		)
		expect(container.querySelectorAll('circle.analytics-chart__dot--comparison')).toHaveLength(2)
	})
})
