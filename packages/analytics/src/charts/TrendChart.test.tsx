import { cleanup, fireEvent, render } from '@testing-library/react'
import type { ReactNode } from 'react'
import { renderToString } from 'react-dom/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { analyticsCss, declarationsOf } from '../testing/stylesheet'
import { monotoneAreaSegments } from './spline'
import { TrendChart, type TrendPoint } from './TrendChart'

vi.mock('./spline', async (original) => {
	const actual = await original<typeof import('./spline')>()
	return { ...actual, monotoneAreaSegments: vi.fn(actual.monotoneAreaSegments) }
})

let serial = 0
const point = (label: string, value: number | null): TrendPoint => ({
	at: new Date(Date.UTC(2026, 5, 1) + serial++ * 86_400_000).toISOString(),
	label,
	value,
	display: value === null ? '-' : String(value),
})

const primary = [point('Mon', 4), point('Tue', 8), point('Wed', 2), point('Thu', 6)]
const previous = [point('Mon', 1), point('Tue', 3), point('Wed', 9), point('Thu', 5)]

const sized = (prop: 'clientWidth' | 'clientHeight', value: number): void => {
	Object.defineProperty(HTMLElement.prototype, prop, { configurable: true, value })
}

beforeEach(() => {
	sized('clientWidth', 600)
	sized('clientHeight', 200)
})

afterEach(() => {
	cleanup()
	vi.unstubAllGlobals()
})

const plotOf = (container: HTMLElement): HTMLElement => {
	const plot = container.querySelector<HTMLElement>('.analytics-chart__plot')
	if (!plot) {
		throw new Error('no plot')
	}
	return plot
}

/** jsdom's PointerEvent drops coordinates; a MouseEvent named `pointermove` carries clientX. */
const pointAt = (container: HTMLElement, clientX: number): void => {
	fireEvent(plotOf(container), new MouseEvent('pointermove', { bubbles: true, clientX }))
}

const share = (element: Element | undefined, property: '--analytics-x' | '--analytics-y') =>
	Number.parseFloat((element as HTMLElement | undefined)?.style.getPropertyValue(property) ?? '')

const tooltipText = (container: HTMLElement): string | undefined =>
	container.querySelector('.analytics-chart__tooltip')?.textContent ?? undefined

// The plot's own coordinates, as the component draws them: 1000 units with 12 of padding.
const FLOOR = 98.8
const CEILING = 1.2

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
		pointAt(container, 600)
		expect(tooltipText(container)).toContain('Previous period')
		expect(tooltipText(container)).not.toContain('Jul 17, 2026')
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
		pointAt(container, 600)
		expect(tooltipText(container)).toContain('Thu')
		expect(tooltipText(container)).toContain('6')
		expect(tooltipText(container)).toContain('Previous period')
		expect(tooltipText(container)).toContain('5')
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
		const dots = [
			...container.querySelectorAll('.analytics-chart__dot:not(.analytics-chart__dot--comparison)'),
		]
		// A flat primary alone would sit on the midline; against a comparison that peaks at
		// 10 it sits on the floor of the shared scale.
		expect(share(dots[0], '--analytics-y')).toBeCloseTo(FLOOR)
		const comparisonDots = [...container.querySelectorAll('.analytics-chart__dot--comparison')]
		expect(share(comparisonDots[1], '--analytics-y')).toBeCloseTo(CEILING)
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
		expect(container.querySelectorAll('.analytics-chart__dot--comparison')).toHaveLength(
			primary.length
		)
	})

	it('keys on the bucket start, so repeated labels raise no duplicate-key error', () => {
		const errors = vi.spyOn(console, 'error').mockImplementation(() => {})
		// Two weeks of weekday labels: "Mon" through "Thu" appear twice over.
		const fortnight = [...primary, ...primary.map((p) => point(p.label, p.value))]
		render(
			<TrendChart
				ariaLabel="Pageviews"
				buckets={fortnight}
				comparison={fortnight}
				comparisonLabel="Previous period"
				label="Pageviews"
			/>
		)
		expect(errors).not.toHaveBeenCalled()
		errors.mockRestore()
	})

	it('falls back to the index when a point carries no bucket start', () => {
		const errors = vi.spyOn(console, 'error').mockImplementation(() => {})
		const unstamped: TrendPoint[] = [
			{ at: '', label: 'Mon', value: 1, display: '1' },
			{ at: '', label: 'Mon', value: 2, display: '2' },
		]
		render(<TrendChart ariaLabel="Pageviews" buckets={unstamped} />)
		expect(errors).not.toHaveBeenCalled()
		errors.mockRestore()
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
		expect(container.querySelectorAll('.analytics-chart__dot--comparison')).toHaveLength(2)
	})
})

describe('TrendChart keyboard access', () => {
	it('names the series and takes focus', () => {
		const { container } = render(
			<TrendChart ariaLabel="Pageviews, last 7 days" buckets={primary} />
		)
		const plot = plotOf(container)
		expect(plot.getAttribute('role')).toBe('img')
		expect(plot.getAttribute('aria-label')).toBe('Pageviews, last 7 days')
		expect(plot.getAttribute('tabindex')).toBe('0')
		expect(container.querySelector('svg')?.getAttribute('aria-hidden')).toBe('true')
	})

	it('steps through the series with the arrow keys and clears on Escape', () => {
		const { container } = render(<TrendChart ariaLabel="Pageviews" buckets={primary} />)
		const plot = plotOf(container)
		fireEvent.keyDown(plot, { key: 'ArrowRight' })
		expect(tooltipText(container)).toContain('Mon')
		fireEvent.keyDown(plot, { key: 'ArrowRight' })
		expect(tooltipText(container)).toContain('Tue')
		fireEvent.keyDown(plot, { key: 'End' })
		expect(tooltipText(container)).toContain('Thu')
		fireEvent.keyDown(plot, { key: 'Escape' })
		expect(container.querySelector('.analytics-chart__tooltip')).toBeNull()
	})

	// A screen reader reads the numbers from the table; a live readout would talk over every step.
	it('keeps its readout out of live regions', () => {
		const { container } = render(<TrendChart ariaLabel="Pageviews" buckets={primary} />)
		fireEvent.keyDown(plotOf(container), { key: 'Home' })
		expect(tooltipText(container)).toContain('Mon')
		expect(container.querySelector('[aria-live]')).toBeNull()
	})

	it('reads the tooltip label in place of the axis tick when one is given', () => {
		const { container } = render(
			<TrendChart
				ariaLabel="Pageviews"
				buckets={[
					{
						at: '2026-06-01T09:00:00.000Z',
						label: '9 AM',
						tooltipLabel: 'Mon, 9 AM',
						value: 5,
						display: '5',
					},
				]}
			/>
		)
		fireEvent.keyDown(plotOf(container), { key: 'Home' })
		expect(container.querySelector('.analytics-chart__tooltip-label')?.textContent).toBe(
			'Mon, 9 AM'
		)
		expect(container.querySelector('.analytics-chart__tick')?.textContent).toBe('9 AM')
	})
})

describe('TrendChart data table', () => {
	const tableOf = (container: HTMLElement): HTMLTableElement => {
		const table = container.querySelector<HTMLTableElement>('table.analytics-chart__table')
		if (!table) {
			throw new Error('no table')
		}
		return table
	}

	it('gives assistive tech every bucket as a row, visually hidden', () => {
		const { container } = render(
			<TrendChart
				ariaLabel="Pageviews, last 7 days"
				buckets={primary}
				label="Pageviews"
				periodLabel="Period"
			/>
		)
		const table = tableOf(container)
		// Hidden by a wrapper: a table takes its rows' height whatever height it is given.
		expect(table.parentElement?.className).toBe('analytics-sr-only')
		expect(table.classList.contains('analytics-sr-only')).toBe(false)
		expect(table.querySelector('caption')?.textContent).toBe('Pageviews, last 7 days')
		expect([...table.querySelectorAll('thead th')].map((cell) => cell.textContent)).toEqual([
			'Period',
			'Pageviews',
		])
		const rows = [...table.querySelectorAll('tbody tr')].map((row) => [
			row.querySelector('th[scope="row"]')?.textContent,
			row.querySelector('td')?.textContent,
		])
		expect(rows).toEqual([
			['Mon', '4'],
			['Tue', '8'],
			['Wed', '2'],
			['Thu', '6'],
		])
	})

	it('adds the previous period as a column, and names an hour by its day', () => {
		const { container } = render(
			<TrendChart
				ariaLabel="Pageviews"
				buckets={[
					{
						at: '2026-06-01T09:00:00.000Z',
						label: '9 AM',
						tooltipLabel: 'Mon 9 AM',
						value: 5,
						display: '5',
					},
				]}
				comparison={[{ at: '2026-05-31T09:00:00.000Z', label: '9 AM', value: 2, display: '2' }]}
				comparisonLabel="Previous period"
				label="Pageviews"
			/>
		)
		const table = tableOf(container)
		expect([...table.querySelectorAll('thead th')].map((cell) => cell.textContent)).toEqual([
			'Pageviews',
			'Previous period',
		])
		expect([...table.querySelectorAll('tbody tr > *')].map((cell) => cell.textContent)).toEqual([
			'Mon 9 AM',
			'5',
			'2',
		])
	})
})

describe('TrendChart render cost', () => {
	it('computes the geometry once per series, not on every hover', () => {
		const traced = vi.mocked(monotoneAreaSegments)
		traced.mockClear()
		const { container } = render(<TrendChart ariaLabel="Pageviews" buckets={primary} />)
		const drawn = traced.mock.calls.length
		expect(drawn).toBeGreaterThan(0)
		pointAt(container, 100)
		pointAt(container, 500)
		fireEvent.keyDown(plotOf(container), { key: 'ArrowLeft' })
		expect(traced.mock.calls.length).toBe(drawn)
	})

	// The SVG stretches its own coordinates to the box: nothing is measured, so the server's
	// markup is the browser's and a resize redraws nothing.
	it('scales by its viewBox and draws the same on the server as in the browser', () => {
		const resize = vi.fn()
		vi.stubGlobal('ResizeObserver', resize)
		const chart = <TrendChart ariaLabel="Pageviews" buckets={primary} />
		const { container } = render(chart)
		const svg = container.querySelector('svg')
		expect(svg?.getAttribute('viewBox')).toBe('0 0 1000 1000')
		expect(svg?.getAttribute('preserveAspectRatio')).toBe('none')
		expect(svg?.hasAttribute('width')).toBe(false)
		expect(resize).not.toHaveBeenCalled()
		const server = renderToString(chart)
		expect(server).toContain('viewBox="0 0 1000 1000"')
		expect(server).toContain(
			container.querySelector('path.analytics-chart__line')?.getAttribute('d') ?? 'missing'
		)
	})
})

describe('TrendChart right to left', () => {
	const rtl = (chart: ReactNode) => render(<div dir="rtl">{chart}</div>)

	it('walks the series with the arrow that points forward in the reading direction', () => {
		const { container } = rtl(<TrendChart ariaLabel="Pageviews" buckets={primary} />)
		const plot = plotOf(container)
		fireEvent.keyDown(plot, { key: 'ArrowLeft' })
		expect(tooltipText(container)).toContain('Mon')
		fireEvent.keyDown(plot, { key: 'ArrowLeft' })
		expect(tooltipText(container)).toContain('Tue')
		fireEvent.keyDown(plot, { key: 'ArrowRight' })
		expect(tooltipText(container)).toContain('Mon')
	})

	it('reads the latest bucket at the left edge, where the mirrored axis ends', () => {
		const { container } = rtl(<TrendChart ariaLabel="Pageviews" buckets={primary} />)
		pointAt(container, 0)
		expect(tooltipText(container)).toContain('Thu')
		pointAt(container, 600)
		expect(tooltipText(container)).toContain('Mon')
	})

	it('reads the earliest bucket at the left edge left to right', () => {
		const { container } = render(<TrendChart ariaLabel="Pageviews" buckets={primary} />)
		pointAt(container, 0)
		expect(tooltipText(container)).toContain('Mon')
	})

	it('mirrors the drawing in the stylesheet and places every overlay by its logical inset', () => {
		expect(
			declarationsOf(
				'.analytics-chart__canvas:is(:dir(rtl), [dir="rtl"] *) > .analytics-chart__svg'
			)
		).toEqual({
			transform: 'scaleX(-1)',
		})
		for (const overlay of [
			'.analytics-chart__dot',
			'.analytics-chart__cursor',
			'.analytics-chart__tick',
			'.analytics-chart__tooltip',
		]) {
			const rule = declarationsOf(overlay)
			expect(rule.left, overlay).toBeUndefined()
			expect(rule.right, overlay).toBeUndefined()
		}
		expect(declarationsOf('.analytics-chart__tick')['inset-inline-start']).toBe(
			'var(--analytics-x, 0)'
		)
		expect(
			declarationsOf('.analytics-chart__tick--middle:is(:dir(rtl), [dir="rtl"] *)').transform
		).toBe('translateX(50%)')
		expect(declarationsOf('.analytics-chart__tick--end')['inset-inline']).toBe('auto 0')
	})
})

describe('TrendChart gaps', () => {
	// A bucket with no reading is no data: the readout says so and hangs on no point.
	it('reads a null bucket as a dash and marks no point for it', () => {
		const { container } = render(
			<TrendChart
				ariaLabel="Avg. time"
				buckets={[point('Mon', 4), point('Tue', null), point('Wed', 6)]}
			/>
		)
		expect(container.querySelectorAll('.analytics-chart__dot')).toHaveLength(2)
		const plot = plotOf(container)
		fireEvent.keyDown(plot, { key: 'Home' })
		fireEvent.keyDown(plot, { key: 'ArrowRight' })
		expect(container.querySelector('.analytics-chart__tooltip-value')?.textContent).toBe('-')
		expect(container.querySelector('.analytics-chart__active')).toBeNull()
	})

	it('dots a lone reading even in a series too long for dots', () => {
		const long = Array.from({ length: 20 }, (_, i) => point(`D${i}`, i === 9 ? 5 : null))
		const { container } = render(<TrendChart ariaLabel="Avg. time" buckets={long} />)
		expect(container.querySelectorAll('.analytics-chart__dot')).toHaveLength(1)
		expect(container.querySelector('path.analytics-chart__line')).toBeNull()
	})
})

describe('TrendChart hours to come', () => {
	const toCome = (label: string, value: number | null = null): TrendPoint => ({
		...point(label, value),
		upcoming: true,
	})
	// Today at 12:20 AM: one hour read, the other 23 still to come.
	const day = (): TrendPoint[] => [
		point('12 AM', 9),
		...Array.from({ length: 23 }, (_, i) => toCome(`${i + 1}h`)),
	]

	it('keeps the whole day on the axis, the hour read at its start', () => {
		const { container } = render(<TrendChart ariaLabel="Pageviews" buckets={day()} />)
		const dots = [...container.querySelectorAll('.analytics-chart__dot')]
		expect(dots).toHaveLength(1)
		expect(share(dots[0], '--analytics-x')).toBe(0)
		const ticks = [...container.querySelectorAll('.analytics-chart__tick')].map(
			(tick) => tick.textContent
		)
		expect(ticks[0]).toBe('12 AM')
		expect(ticks.at(-1)).toBe('23h')
	})

	it('draws no line and gives no row to an hour to come, even one passed as zero', () => {
		const traced = vi.mocked(monotoneAreaSegments)
		traced.mockClear()
		const buckets = [
			point('12 AM', 9),
			point('1 AM', 4),
			...Array.from({ length: 22 }, (_, i) => toCome(`${i + 2}h`, 0)),
		]
		const { container } = render(
			<TrendChart
				ariaLabel="Pageviews"
				buckets={buckets}
				comparison={buckets.map((bucket) => ({ ...bucket, value: 3, upcoming: false }))}
				comparisonLabel="Previous period"
				label="Pageviews"
			/>
		)
		expect(traced.mock.calls).toHaveLength(2)
		for (const [values] of traced.mock.calls) {
			expect(values).toHaveLength(24)
			expect(values.slice(2).every((value) => value === null)).toBe(true)
		}
		expect(container.querySelectorAll('table.analytics-chart__table tbody tr')).toHaveLength(2)
	})

	it('walks the readout no further than the last hour read', () => {
		const { container } = render(<TrendChart ariaLabel="Pageviews" buckets={day()} />)
		pointAt(container, 590)
		expect(tooltipText(container)).toContain('12 AM')
		const plot = plotOf(container)
		fireEvent.keyDown(plot, { key: 'End' })
		expect(tooltipText(container)).toContain('12 AM')
		fireEvent.keyDown(plot, { key: 'ArrowRight' })
		expect(tooltipText(container)).toContain('12 AM')
	})
})

describe('TrendChart fill', () => {
	it('grows into its container from a floor of minHeight', () => {
		const { container } = render(
			<TrendChart ariaLabel="Pageviews" buckets={primary} fill minHeight={120} />
		)
		const root = container.querySelector<HTMLElement>('.analytics-chart')
		expect(root?.classList.contains('analytics-chart--fill')).toBe(true)
		expect(root?.style.getPropertyValue('--analytics-chart-height')).toBe('120px')
	})

	it('keeps sizing itself to minHeight without fill', () => {
		const { container } = render(<TrendChart ariaLabel="Pageviews" buckets={primary} />)
		const root = container.querySelector<HTMLElement>('.analytics-chart')
		expect(root?.classList.contains('analytics-chart--trend')).toBe(true)
		expect(root?.classList.contains('analytics-chart--fill')).toBe(false)
		expect(root?.style.getPropertyValue('--analytics-chart-height')).toBe('160px')
	})
})

describe('TrendChart bucket still counting', () => {
	const counting = [
		point('Mon', 4),
		point('Tue', 8),
		{ ...point('Wed', 2), inProgress: true, tooltipLabel: 'Wed (so far)' },
	]

	it('draws the line into it dashed, the rest solid, on one path clipped twice', () => {
		const { container } = render(<TrendChart ariaLabel="Pageviews" buckets={counting} />)
		const lines = [...container.querySelectorAll('path.analytics-chart__line')]
		expect(lines).toHaveLength(2)
		expect(lines[0]?.getAttribute('d')).toBe(lines[1]?.getAttribute('d'))
		expect(lines[1]?.classList.contains('analytics-chart__line--partial')).toBe(true)
		const [done, partial] = lines.map((line) => line.getAttribute('clip-path'))
		expect(done).not.toBe(partial)
		// The dashed stretch runs from the last finished bucket to the one still counting.
		const clip = container.querySelector(`[id="${partial?.slice(5, -1)}"] rect`)
		expect(clip?.getAttribute('x')).toBe('500')
		expect(clip?.getAttribute('width')).toBe('500')
		expect(declarationsOf('.analytics-chart__line--partial')['stroke-dasharray']).toBe('4 3')
	})

	it('names it "so far" in the data table', () => {
		const { container } = render(<TrendChart ariaLabel="Pageviews" buckets={counting} />)
		const periods = [...container.querySelectorAll('.analytics-chart__table tbody th')].map(
			(cell) => cell.textContent
		)
		expect(periods.at(-1)).toBe('Wed (so far)')
	})

	it('draws a single solid line when every bucket is finished', () => {
		const { container } = render(<TrendChart ariaLabel="Pageviews" buckets={primary} />)
		const lines = container.querySelectorAll('path.analytics-chart__line')
		expect(lines).toHaveLength(1)
		expect(lines[0]?.hasAttribute('clip-path')).toBe(false)
	})
})

describe('TrendChart comparison look', () => {
	// The two series differ by more than their hue: the comparison is dashed, line and swatch.
	it('dashes the comparison line and its legend swatch', () => {
		expect(declarationsOf('.analytics-chart__comparison')['stroke-dasharray']).toBe('4 3')
		expect(analyticsCss()).toContain(
			'.analytics-chart__legend-swatch--comparison {\n\t\twidth: 0.875rem;\n\t\tbackground: repeating-linear-gradient('
		)
	})
})

describe('TrendChart readout placement', () => {
	const tooltip = (container: HTMLElement) =>
		container.querySelector('.analytics-chart__tooltip')?.className ?? ''

	it('opens inward at either end of the axis, so it stays on the card', () => {
		const { container } = render(<TrendChart ariaLabel="Pageviews" buckets={primary} />)
		const plot = plotOf(container)
		fireEvent.keyDown(plot, { key: 'Home' })
		expect(tooltip(container)).toContain('analytics-chart__tooltip--start')
		fireEvent.keyDown(plot, { key: 'End' })
		expect(tooltip(container)).toContain('analytics-chart__tooltip--end')
	})

	it('opens below a point high in the plot, clear of the legend above it', () => {
		const { container } = render(<TrendChart ariaLabel="Pageviews" buckets={primary} />)
		const plot = plotOf(container)
		// Tue holds the highest reading, at the top of the plot.
		fireEvent.keyDown(plot, { key: 'Home' })
		fireEvent.keyDown(plot, { key: 'ArrowRight' })
		expect(tooltip(container)).toContain('analytics-chart__tooltip--below')
		// Wed holds the lowest, at the bottom: the readout opens above it.
		fireEvent.keyDown(plot, { key: 'ArrowRight' })
		expect(tooltip(container)).not.toContain('analytics-chart__tooltip--below')
	})

	it('keeps the edge and below rules in the stylesheet, mirrored for right to left', () => {
		expect(declarationsOf('.analytics-chart__tooltip--below')['--analytics-tip-y']).toBe('10px')
		expect(declarationsOf('.analytics-chart__tooltip--end')['--analytics-tip-x']).toBe('-100%')
		expect(
			declarationsOf('.analytics-chart__tooltip--end:is(:dir(rtl), [dir="rtl"] *)')[
				'--analytics-tip-x'
			]
		).toBe('100%')
	})
})

describe('TrendChart dismissing', () => {
	// WCAG 1.4.13: content shown on hover can be dismissed without moving the pointer.
	it('drops a readout the pointer opened on Escape, wherever focus is', () => {
		const { container } = render(<TrendChart ariaLabel="Pageviews" buckets={primary} />)
		pointAt(container, 300)
		expect(tooltipText(container)).toBeDefined()
		fireEvent.keyDown(document, { key: 'Escape' })
		expect(tooltipText(container)).toBeUndefined()
	})

	it('tells a screen reader on the plot that the arrow keys walk it', () => {
		const { container } = render(
			<TrendChart ariaLabel="Pageviews" buckets={primary} keyboardHint="Use the arrow keys" />
		)
		const described = plotOf(container).getAttribute('aria-describedby')
		expect(described).toBeTruthy()
		expect(document.getElementById(described ?? '')?.textContent).toBe('Use the arrow keys')
		expect(plotOf(container).contains(document.getElementById(described ?? ''))).toBe(false)
	})

	it('reads a missing reading out as no value in the data table', () => {
		const { container } = render(
			<TrendChart
				ariaLabel="Average"
				buckets={[point('Mon', 3), point('Tue', null)]}
				noValueLabel="No value"
			/>
		)
		const cells = [...container.querySelectorAll('.analytics-chart__table tbody td')]
		expect(cells[1]?.querySelector('.analytics-sr-only')?.textContent).toBe('No value')
	})
})
