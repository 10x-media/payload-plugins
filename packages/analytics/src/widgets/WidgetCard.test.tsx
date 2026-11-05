import { cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { declarationsOf } from '../testing/stylesheet'
import { WidgetBody, WidgetCard, WidgetEmpty, WidgetNote, WidgetValue } from './WidgetCard'

afterEach(() => {
	cleanup()
})

const part = (container: HTMLElement, name: string): HTMLElement | null =>
	container.querySelector<HTMLElement>(`.analytics-widget__${name}`)

describe('WidgetCard', () => {
	// The dashboard stretches every widget in a row to the row's height; a card that stopped
	// at its content would stand shorter than its neighbours, with its link floating.
	it('fills its dashboard slot as a column', () => {
		const { container } = render(
			<WidgetCard className="analytics-metric-widget" title="Pageviews" />
		)
		const card = container.firstElementChild as HTMLElement
		expect([...card.classList]).toEqual([
			'analytics-card',
			'analytics-widget',
			'analytics-metric-widget',
		])
		expect(card.getAttribute('style')).toBeNull()
		expect(declarationsOf('.analytics-widget')).toMatchObject({
			display: 'flex',
			'flex-direction': 'column',
			height: '100%',
		})
		expect(declarationsOf('.analytics-card')).toMatchObject({
			'box-sizing': 'border-box',
			background: 'var(--analytics-card-bg)',
			'border-radius': 'var(--analytics-card-radius)',
		})
	})

	// Payload's own dashboard widgets title themselves with an h2, and heading navigation is how
	// a screen reader moves from card to card.
	it('titles the card with a heading that keeps the small label look', () => {
		const { getByRole } = render(<WidgetCard caption="Last 30 days" title="Pageviews" />)
		const heading = getByRole('heading', { level: 2, name: 'Pageviews' })
		expect(heading.className).toBe('analytics-widget__title')
		expect(declarationsOf('.analytics-widget__title')).toMatchObject({
			margin: '0',
			'line-height': 'inherit',
		})
	})

	it('puts the title and the window on one header line', () => {
		const { container } = render(<WidgetCard caption="Last 30 days" title="Pageviews" />)
		const header = part(container, 'header')
		expect(header?.children).toHaveLength(2)
		expect(header?.firstElementChild?.textContent).toBe('Pageviews')
		expect(header?.lastElementChild?.textContent).toBe('Last 30 days')
		expect(declarationsOf('.analytics-widget__header')['justify-content']).toBe('space-between')
	})

	it('leaves the window out when there is none to state', () => {
		const { container } = render(<WidgetCard title="Pageviews" />)
		expect(part(container, 'caption')).toBeNull()
	})

	it('floors the footer link at the bottom, and renders none without a target', () => {
		const { container, rerender } = render(
			<WidgetCard
				link={{ href: '/admin/analytics', label: 'Open in Analytics' }}
				title="Pageviews"
			/>
		)
		const footer = part(container, 'footer')
		expect(declarationsOf('.analytics-widget__footer')['margin-block-start']).toBe('auto')
		expect(footer?.querySelector('a')?.getAttribute('href')).toBe('/admin/analytics')
		rerender(<WidgetCard link={{ label: 'Open in Analytics' }} title="Pageviews" />)
		expect(part(container, 'footer')).toBeNull()
	})

	// A dashboard holds many "Open in Analytics" links; each says which card it opens.
	it('describes its footer link by the card title', () => {
		const { container } = render(
			<WidgetCard
				link={{ href: '/admin/analytics', label: 'Open in Analytics' }}
				title="Pageviews"
			/>
		)
		const link = container.querySelector('a')
		const described = document.getElementById(link?.getAttribute('aria-describedby') ?? '')
		expect(described?.tagName).toBe('H2')
		expect(described?.textContent).toBe('Pageviews')
	})

	it('keeps the value row, the body and the note in reading order', () => {
		const { container } = render(
			<WidgetCard caption="Last 30 days" title="Pageviews">
				<WidgetValue value="1,234">
					<span>+12%</span>
				</WidgetValue>
				<WidgetBody>
					<span>chart</span>
				</WidgetBody>
				<WidgetNote>Numbers are approximate</WidgetNote>
			</WidgetCard>
		)
		const card = container.firstElementChild as HTMLElement
		expect([...card.children].map((child) => child.className)).toEqual([
			'analytics-widget__header',
			'analytics-widget__value-row',
			'analytics-widget__body',
			'analytics-widget__note',
		])
		expect(part(container, 'value-row')?.textContent).toBe('1,234+12%')
		expect(declarationsOf('.analytics-widget__body').flex).toBe('1 1 auto')
	})

	it('centers a message in the room the body would have taken', () => {
		const { container } = render(
			<WidgetCard title="Pageviews">
				<WidgetEmpty>No data yet</WidgetEmpty>
			</WidgetCard>
		)
		expect(part(container, 'empty')?.textContent).toBe('No data yet')
		expect(declarationsOf('.analytics-widget__empty')).toMatchObject({
			flex: '1 1 auto',
			'align-items': 'center',
			'justify-content': 'center',
		})
	})

	it('renders no note for a read with no caveats', () => {
		const { container } = render(<WidgetNote>{''}</WidgetNote>)
		expect(container.firstChild).toBeNull()
	})
})
