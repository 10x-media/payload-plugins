import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { createElement } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { DialogSurface } from './DialogSurface'

afterEach(() => {
	cleanup()
})

describe('DialogSurface', () => {
	it('renders a dialog with correct aria attributes', () => {
		const onClose = vi.fn()
		render(
			createElement(
				DialogSurface,
				{ open: true, onClose, label: 'Contact', surface: 'modal' },
				createElement('button', { type: 'button' }, 'inside')
			)
		)
		const dialog = screen.getByRole('dialog')
		expect(dialog).toHaveAttribute('aria-modal', 'true')
		expect(dialog).toHaveAttribute('aria-label', 'Contact')
	})

	it('renders a close button', () => {
		const onClose = vi.fn()
		render(
			createElement(
				DialogSurface,
				{ open: true, onClose, label: 'Test' },
				createElement('span', null, 'content')
			)
		)
		expect(screen.getByRole('button', { name: 'Close' })).toBeInTheDocument()
	})

	it('clicking the close button calls onClose', () => {
		const onClose = vi.fn()
		render(
			createElement(
				DialogSurface,
				{ open: true, onClose, label: 'Test' },
				createElement('span', null, 'content')
			)
		)
		fireEvent.click(screen.getByRole('button', { name: 'Close' }))
		expect(onClose).toHaveBeenCalledTimes(1)
	})

	it('pressing Escape calls onClose', () => {
		const onClose = vi.fn()
		render(
			createElement(
				DialogSurface,
				{ open: true, onClose, label: 'Test' },
				createElement('span', null, 'content')
			)
		)
		fireEvent.keyDown(document, { key: 'Escape' })
		expect(onClose).toHaveBeenCalledTimes(1)
	})

	it('focuses the dialog element on mount', () => {
		const onClose = vi.fn()
		render(
			createElement(
				DialogSurface,
				{ open: true, onClose, label: 'Test' },
				createElement('button', { type: 'button' }, 'inner')
			)
		)
		const dialog = screen.getByRole('dialog')
		expect(dialog === document.activeElement || dialog.contains(document.activeElement)).toBe(true)
	})

	it('restores focus to the opener after unmount', () => {
		const onClose = vi.fn()
		const { unmount, getByRole: getByRoleOuter } = render(
			createElement(
				'div',
				null,
				createElement('button', { type: 'button', 'data-testid': 'opener' }, 'opener')
			)
		)
		const opener = getByRoleOuter('button', { name: 'opener' }) as HTMLElement
		opener.focus()
		expect(document.activeElement).toBe(opener)

		const { unmount: unmountDialog } = render(
			createElement(
				DialogSurface,
				{ open: true, onClose, label: 'Test' },
				createElement('span', null, 'content')
			)
		)
		unmountDialog()
		expect(document.activeElement).toBe(opener)
		unmount()
	})

	it('renders nothing when open is false', () => {
		const onClose = vi.fn()
		render(createElement(DialogSurface, { open: false, onClose, label: 'Test' }, null))
		expect(screen.queryByRole('dialog')).toBeNull()
	})

	it('respects a custom closeLabel', () => {
		const onClose = vi.fn()
		render(
			createElement(
				DialogSurface,
				{ open: true, onClose, label: 'Test', closeLabel: 'Dismiss' },
				createElement('span', null, 'content')
			)
		)
		expect(screen.getByRole('button', { name: 'Dismiss' })).toBeInTheDocument()
	})
})
