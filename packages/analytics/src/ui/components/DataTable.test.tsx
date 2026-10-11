import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { DataTable, type DataTableColumn, type DataTableRow, rowKeys } from './DataTable'

afterEach(() => {
	cleanup()
	vi.unstubAllGlobals()
})

const rows: DataTableRow[] = [
	{ key: '/pricing', label: '/pricing', bar: 1, cells: ['120', '90'] },
	{ key: '/about', label: '/about', bar: 0.5, cells: ['60', '40'] },
]

const columns = (
	over: Partial<Record<'pageviews' | 'visitors', Partial<DataTableColumn>>> = {}
) => [
	{ key: 'pageviews', header: 'Pageviews', ...over.pageviews },
	{ key: 'visitors', header: 'Visitors', ...over.visitors },
]

describe('DataTable', () => {
	it('is a table named by its label, with column headers and a row header per row', () => {
		render(<DataTable columns={columns()} label="Top pages" labelHeader="Page" rows={rows} />)
		expect(screen.getByRole('table', { name: 'Top pages' })).toBeDefined()
		expect(screen.getAllByRole('columnheader').map((cell) => cell.textContent)).toEqual([
			'Page',
			'Pageviews',
			'Visitors',
		])
		const headers = screen.getAllByRole('rowheader')
		expect(headers.map((cell) => cell.textContent)).toEqual(['/pricing', '/about'])
		expect(headers.every((cell) => cell.getAttribute('scope') === 'row')).toBe(true)
		expect(screen.getAllByRole('cell').map((cell) => cell.textContent)).toEqual([
			'120',
			'90',
			'60',
			'40',
		])
	})

	it('says aria-sort on the one column the rows are ordered by, with the sort button inside', () => {
		const onSort = vi.fn()
		render(
			<DataTable
				columns={columns({
					pageviews: { sorted: 'descending', onSort },
					visitors: { onSort },
				})}
				label="Top pages"
				labelHeader="Page"
				rows={rows}
			/>
		)
		const [label, sorted, other] = screen.getAllByRole('columnheader')
		expect(label?.hasAttribute('aria-sort')).toBe(false)
		expect(sorted?.getAttribute('aria-sort')).toBe('descending')
		expect(other?.hasAttribute('aria-sort')).toBe(false)
		// The button carries the column's name alone; the header says how it is sorted.
		const button = screen.getByRole('button', { name: 'Visitors' })
		expect(other?.contains(button)).toBe(true)
		fireEvent.click(button)
		expect(onSort).toHaveBeenCalledTimes(1)
		expect(sorted?.querySelector('.analytics-table__sort-arrow')).not.toBeNull()
		expect(other?.querySelector('.analytics-table__sort-arrow')).toBeNull()
	})

	it('leaves a column it cannot sort by a plain header', () => {
		render(<DataTable columns={columns()} label="Goals" labelHeader="Goal" rows={rows} />)
		expect(screen.queryByRole('button')).toBeNull()
	})

	it('puts a row filter in the row header, named by the label and its decoration hidden', () => {
		const onSelect = vi.fn()
		render(
			<DataTable
				bars="soft"
				columns={columns()}
				label="Countries"
				labelHeader="Country"
				rows={[
					{ ...rows[0], decoration: <span>flag</span>, onSelect } as DataTableRow,
					rows[1] as DataTableRow,
				]}
			/>
		)
		const button = screen.getByRole('button', { name: '/pricing' })
		expect(screen.getAllByRole('rowheader')[0]?.contains(button)).toBe(true)
		fireEvent.click(button)
		expect(onSelect).toHaveBeenCalledTimes(1)
		expect(screen.queryByRole('button', { name: '/about' })).toBeNull()
	})

	it('draws each share as its row header background, not as an element of its own', () => {
		const { container } = render(
			<DataTable
				bars="solid"
				columns={columns()}
				label="Top pages"
				labelHeader="Page"
				rows={rows}
			/>
		)
		const shares = [...container.querySelectorAll<HTMLElement>('tbody tr')].map((row) =>
			row.style.getPropertyValue('--analytics-bar')
		)
		expect(shares).toEqual(['100%', '50%'])
		expect(container.querySelector('.analytics-bars__fill')).toBeNull()
		expect(container.querySelectorAll('th .analytics-bars__track')).toHaveLength(2)
	})

	it('keeps a hidden head for assistive tech, or none at all', () => {
		const { container, rerender } = render(
			<DataTable
				columns={columns()}
				head="hidden"
				label="Top pages"
				labelHeader="Page"
				rows={rows}
			/>
		)
		expect(container.querySelector('thead')?.className).toBe('analytics-sr-only')
		expect(screen.getAllByRole('columnheader')).toHaveLength(3)
		rerender(
			<DataTable columns={columns()} head="none" label="Top pages" labelHeader="Page" rows={rows} />
		)
		expect(container.querySelector('thead')).toBeNull()
	})

	it('says its empty label instead of an empty table', () => {
		render(
			<DataTable
				columns={columns()}
				emptyLabel="Nothing yet"
				label="Top pages"
				labelHeader="Page"
				rows={[]}
			/>
		)
		expect(screen.getByText('Nothing yet')).toBeDefined()
		expect(screen.queryByRole('table')).toBeNull()
	})

	// A keyboard can only scroll what it can reach, and a table that fits needs no extra stop.
	it('becomes a focusable named region only once it scrolls sideways', () => {
		let observed: (() => void) | undefined
		vi.stubGlobal(
			'ResizeObserver',
			class {
				constructor(callback: () => void) {
					observed = callback
				}
				observe(): void {}
				disconnect(): void {}
			}
		)
		const { container } = render(
			<DataTable columns={columns()} label="Top pages" labelHeader="Page" rows={rows} />
		)
		const scroller = container.querySelector<HTMLElement>('.analytics-table__scroll')
		if (!scroller) {
			throw new Error('no scroller')
		}
		expect(scroller.hasAttribute('tabindex')).toBe(false)
		Object.defineProperty(scroller, 'scrollWidth', { configurable: true, value: 900 })
		Object.defineProperty(scroller, 'clientWidth', { configurable: true, value: 300 })
		act(() => observed?.())
		expect(scroller.getAttribute('tabindex')).toBe('0')
		expect(scroller.getAttribute('role')).toBe('region')
		expect(scroller.getAttribute('aria-label')).toBe('Top pages')
	})
})

describe('DataTable labels and readouts', () => {
	const filterable = rows.map((row) => ({ ...row, onSelect: vi.fn() }))

	it('says what a row button does through one hidden hint per table', () => {
		const { container } = render(
			<DataTable
				bars="soft"
				columns={columns()}
				filterHint="Filter by Page"
				label="Top pages"
				labelHeader="Page"
				rows={filterable}
			/>
		)
		const buttons = screen.getAllByRole('button', { name: /^\// })
		const hint = buttons[0]?.getAttribute('aria-describedby')
		expect(hint).toBeTruthy()
		expect(buttons.every((button) => button.getAttribute('aria-describedby') === hint)).toBe(true)
		expect(document.getElementById(hint ?? '')?.textContent).toBe('Filter by Page')
		expect(container.querySelectorAll('.analytics-sr-only[id]')).toHaveLength(1)
	})

	it('keeps a path left to right and lets the stylesheet cut it at its end', () => {
		const { container } = render(
			<DataTable bars="soft" columns={columns()} label="Top pages" labelHeader="Page" rows={rows} />
		)
		const labels = [...container.querySelectorAll('.analytics-bars__label')]
		expect(labels.map((label) => label.getAttribute('dir'))).toEqual(['ltr', 'ltr'])
		render(
			<DataTable
				bars="soft"
				columns={columns()}
				label="Countries"
				labelHeader="Country"
				rows={[{ key: 'de', label: 'Deutschland', cells: ['3', '2'] }]}
			/>
		)
		expect(
			screen.getByText('Deutschland').closest('.analytics-bars__label')?.hasAttribute('dir')
		).toBe(false)
	})

	it('cuts a long plain label short on one line, the whole of it in the title', () => {
		const { container } = render(
			<DataTable columns={columns()} label="Goals" labelHeader="Goal" rows={rows} truncate />
		)
		expect(container.querySelector('table')?.classList.contains('analytics-table--truncate')).toBe(
			true
		)
		const text = container.querySelector('.analytics-table__label-text')
		expect(text?.getAttribute('title')).toBe('/pricing')
	})

	it('reads the dash of a missing reading out as the word it is given', () => {
		render(
			<DataTable
				columns={columns()}
				label="Top pages"
				labelHeader="Page"
				noValueLabel="No value"
				rows={[{ key: 'a', label: '/a', cells: ['-', '4'] }]}
			/>
		)
		const [cell] = screen.getAllByRole('cell')
		expect(cell?.querySelector('[aria-hidden="true"]')?.textContent).toBe('-')
		expect(cell?.querySelector('.analytics-sr-only')?.textContent).toBe('No value')
	})

	// WCAG 1.4.13: content shown on hover can be dismissed without moving the pointer.
	it('drops the hover readout on Escape', () => {
		const { container } = render(
			<DataTable bars="soft" columns={columns()} label="Top pages" labelHeader="Page" rows={rows} />
		)
		const row = container.querySelector('tbody tr')
		if (!row) {
			throw new Error('no row')
		}
		fireEvent(row, new MouseEvent('pointerenter', { clientX: 10, clientY: 10 }))
		fireEvent(row, new MouseEvent('pointermove', { bubbles: true, clientX: 10, clientY: 10 }))
		expect(container.querySelector('.analytics-chart__tooltip')).not.toBeNull()
		fireEvent.keyDown(document, { key: 'Escape' })
		expect(container.querySelector('.analytics-chart__tooltip')).toBeNull()
	})

	it('shows the full label of a row button it cuts short when the button takes focus', () => {
		const { container } = render(
			<DataTable
				bars="soft"
				columns={columns()}
				label="Top pages"
				labelHeader="Page"
				rows={filterable}
			/>
		)
		const [cut, whole] = [...container.querySelectorAll<HTMLElement>('.analytics-bars__label')]
		if (!cut || !whole) {
			throw new Error('no labels')
		}
		Object.defineProperty(cut, 'scrollWidth', { configurable: true, value: 300 })
		Object.defineProperty(cut, 'clientWidth', { configurable: true, value: 120 })
		const [first, second] = screen.getAllByRole('button', { name: /^\// })
		fireEvent.focus(second ?? whole)
		expect(container.querySelector('.analytics-chart__tooltip')).toBeNull()
		fireEvent.focus(first ?? cut)
		expect(container.querySelector('.analytics-chart__tooltip')?.textContent).toContain('/pricing')
		fireEvent.blur(first ?? cut)
		expect(container.querySelector('.analytics-chart__tooltip')).toBeNull()
	})

	it('never makes a region without a name, falling back to the label column', () => {
		let observed: (() => void) | undefined
		vi.stubGlobal(
			'ResizeObserver',
			class {
				constructor(callback: () => void) {
					observed = callback
				}
				observe(): void {}
				disconnect(): void {}
			}
		)
		const { container } = render(
			<DataTable columns={columns()} head="none" label="" labelHeader="Page" rows={rows} />
		)
		const scroller = container.querySelector<HTMLElement>('.analytics-table__scroll')
		if (!scroller) {
			throw new Error('no scroller')
		}
		Object.defineProperty(scroller, 'scrollWidth', { configurable: true, value: 900 })
		Object.defineProperty(scroller, 'clientWidth', { configurable: true, value: 300 })
		act(() => observed?.())
		expect(scroller.getAttribute('role')).toBe('region')
		expect(scroller.getAttribute('aria-label')).toBe('Page')
	})
})

describe('rowKeys', () => {
	it('keys by label, by rank only where a label repeats or is empty', () => {
		expect(rowKeys([{ label: 'a' }, { label: '' }, { label: 'a' }])).toEqual(['a', '#1', 'a#2'])
	})
})
