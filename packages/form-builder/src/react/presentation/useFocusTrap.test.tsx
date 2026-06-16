import { cleanup, fireEvent, render } from '@testing-library/react'
import { createElement, useRef } from 'react'
import { afterEach, describe, expect, it } from 'vitest'
import { useFocusTrap } from './useFocusTrap'

afterEach(() => {
	cleanup()
})

const FocusTrapContainer = ({ active }: { active: boolean }) => {
	const ref = useRef<HTMLDivElement>(null)
	useFocusTrap(ref, active)
	return createElement(
		'div',
		{ ref },
		createElement('button', { type: 'button', 'data-testid': 'first' }, 'First'),
		createElement('button', { type: 'button', 'data-testid': 'last' }, 'Last')
	)
}

describe('useFocusTrap', () => {
	it('wraps Tab forward from last to first', () => {
		const { getByTestId } = render(createElement(FocusTrapContainer, { active: true }))
		const last = getByTestId('last') as HTMLElement
		last.focus()
		expect(document.activeElement).toBe(last)
		fireEvent.keyDown(last, { key: 'Tab' })
		expect(document.activeElement).toBe(getByTestId('first'))
	})

	it('wraps Shift+Tab backward from first to last', () => {
		const { getByTestId } = render(createElement(FocusTrapContainer, { active: true }))
		const first = getByTestId('first') as HTMLElement
		first.focus()
		expect(document.activeElement).toBe(first)
		fireEvent.keyDown(first, { key: 'Tab', shiftKey: true })
		expect(document.activeElement).toBe(getByTestId('last'))
	})

	it('does not trap focus when inactive', () => {
		const { getByTestId } = render(createElement(FocusTrapContainer, { active: false }))
		const last = getByTestId('last') as HTMLElement
		last.focus()
		fireEvent.keyDown(last, { key: 'Tab' })
		expect(document.activeElement).toBe(last)
	})
})
