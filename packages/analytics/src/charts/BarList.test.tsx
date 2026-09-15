import { cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
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
		expect(container.querySelector('.analytics-bars')).toBeDefined()
		expect(container.querySelector('.analytics-bars--soft')).toBeNull()
	})

	it('draws the soft look on request, for a list that can hold a zero-value row', () => {
		const { container } = render(<BarList data={data} emptyLabel="empty" fill="soft" />)
		expect(container.querySelector('.analytics-bars--soft')).not.toBeNull()
	})

	it('renders the secondary column beside the value', () => {
		const { container } = render(<BarList data={data} emptyLabel="empty" />)
		const secondary = container.querySelectorAll('.analytics-bars__secondary')
		expect(secondary).toHaveLength(1)
		expect(secondary[0]?.textContent).toBe('1')
	})
})
