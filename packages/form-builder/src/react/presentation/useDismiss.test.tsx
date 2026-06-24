import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { createElement, useRef } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useDismiss } from './useDismiss'

afterEach(() => {
	cleanup()
})

const DismissTarget = ({
	onDismiss,
	closeOnEscape = true,
	closeOnOutsideClick = true,
}: {
	onDismiss: () => void
	closeOnEscape?: boolean
	closeOnOutsideClick?: boolean
}) => {
	const ref = useRef<HTMLDivElement>(null)
	useDismiss({ active: true, onDismiss, closeOnEscape, closeOnOutsideClick }, ref)
	return createElement(
		'div',
		null,
		createElement('div', { ref, 'data-testid': 'surface' }, createElement('span', null, 'inside')),
		createElement('button', { type: 'button' }, 'outside')
	)
}

describe('useDismiss', () => {
	it('calls onDismiss on Escape keydown', () => {
		const onDismiss = vi.fn()
		render(createElement(DismissTarget, { onDismiss }))
		fireEvent.keyDown(document, { key: 'Escape' })
		expect(onDismiss).toHaveBeenCalledTimes(1)
	})

	it('calls onDismiss when clicking outside the surface', () => {
		const onDismiss = vi.fn()
		render(createElement(DismissTarget, { onDismiss }))
		fireEvent.pointerDown(screen.getByRole('button', { name: 'outside' }))
		expect(onDismiss).toHaveBeenCalledTimes(1)
	})

	it('does NOT call onDismiss when clicking inside the surface', () => {
		const onDismiss = vi.fn()
		render(createElement(DismissTarget, { onDismiss }))
		fireEvent.pointerDown(screen.getByText('inside'))
		expect(onDismiss).not.toHaveBeenCalled()
	})

	it('does not call onDismiss on Escape when closeOnEscape is false', () => {
		const onDismiss = vi.fn()
		render(createElement(DismissTarget, { onDismiss, closeOnEscape: false }))
		fireEvent.keyDown(document, { key: 'Escape' })
		expect(onDismiss).not.toHaveBeenCalled()
	})

	it('does not call onDismiss on outside click when closeOnOutsideClick is false', () => {
		const onDismiss = vi.fn()
		render(createElement(DismissTarget, { onDismiss, closeOnOutsideClick: false }))
		fireEvent.pointerDown(screen.getByRole('button', { name: 'outside' }))
		expect(onDismiss).not.toHaveBeenCalled()
	})
})
