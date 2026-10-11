import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { BarList } from './BarList'

const data = [
	{ label: '/pricing', value: 120, display: '120' },
	{ label: 'book-demo', value: 0, display: '0', secondary: '1' },
]

afterEach(() => {
	cleanup()
})

describe('BarList fill', () => {
	it('draws the solid in-bar look by default, as the widgets ship it', () => {
		const { container } = render(<BarList data={data} emptyLabel="empty" />)
		expect(container.querySelector('.analytics-bars')).not.toBeNull()
		expect(container.querySelector('.analytics-bars--soft')).toBeNull()
	})

	it('draws the soft look on request, for a list that can hold a zero-value row', () => {
		const { container } = render(<BarList data={data} emptyLabel="empty" fill="soft" />)
		expect(container.querySelector('.analytics-bars--soft')).not.toBeNull()
	})

	it('gives the secondary column a cell in every row, beside the value', () => {
		const { container } = render(<BarList data={data} emptyLabel="empty" />)
		const secondary = [...container.querySelectorAll('td.analytics-bars__secondary')]
		expect(secondary.map((cell) => cell.textContent)).toEqual(['', '1'])
	})

	it('replaces rows that share a label instead of stranding them', () => {
		const shared = [
			{ label: '', value: 53, display: '53' },
			{ label: '', value: 51, display: '51' },
		]
		const { container, rerender } = render(<BarList data={shared} emptyLabel="empty" />)
		expect(container.querySelectorAll('.analytics-bars__row')).toHaveLength(2)
		rerender(<BarList data={data} emptyLabel="empty" />)
		expect(
			[...container.querySelectorAll('.analytics-bars__label')].map((row) => row.textContent)
		).toEqual(['/pricing', 'book-demo'])
	})

	it('says so when there is nothing to rank', () => {
		render(<BarList data={[]} emptyLabel="Nothing yet" />)
		expect(screen.getByText('Nothing yet')).toBeDefined()
		expect(document.querySelector('table')).toBeNull()
	})
})

describe('BarList as a table', () => {
	it('makes each label its row header and the bar its background share', () => {
		const { container } = render(
			<BarList
				data={data}
				emptyLabel="empty"
				headers={{ label: 'Page', value: 'Pageviews', secondary: 'Visitors' }}
			/>
		)
		expect(screen.getByRole('table', { name: 'Page' })).toBeDefined()
		expect(screen.getAllByRole('columnheader').map((header) => header.textContent)).toEqual([
			'Page',
			'Pageviews',
			'Visitors',
		])
		expect(screen.getAllByRole('rowheader').map((header) => header.textContent)).toEqual([
			'/pricing',
			'book-demo',
		])
		const rows = [...container.querySelectorAll<HTMLElement>('tbody tr')]
		expect(rows.map((row) => row.style.getPropertyValue('--analytics-bar'))).toEqual(['100%', '0%'])
		// The header row is for assistive tech only: on screen the list draws none.
		expect(container.querySelector('thead')?.classList.contains('analytics-sr-only')).toBe(true)
	})

	it('draws no header row it has no names for', () => {
		const { container } = render(<BarList data={data} emptyLabel="empty" />)
		expect(container.querySelector('thead')).toBeNull()
		expect(container.querySelector('th:empty')).toBeNull()
	})

	it('puts the click in the row header, a button named by the label', () => {
		const onSelect = vi.fn()
		render(
			<BarList
				data={[...data, { label: 'inert', value: 1, selectable: false }]}
				emptyLabel="empty"
				onSelect={onSelect}
			/>
		)
		fireEvent.click(screen.getByRole('button', { name: 'book-demo' }))
		expect(onSelect).toHaveBeenCalledWith(1)
		expect(screen.queryByRole('button', { name: 'inert' })).toBeNull()
		expect(screen.getByRole('rowheader', { name: 'inert' })).toBeDefined()
	})
})
