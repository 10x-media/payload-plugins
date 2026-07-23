'use client'

import { createElement, type ReactNode, useEffect, useRef } from 'react'
import { Backdrop } from './Backdrop'
import { useDismiss } from './useDismiss'
import { useFocusTrap } from './useFocusTrap'
import { useScrollLock } from './useScrollLock'

export type DialogSurfaceProps = {
	open: boolean
	onClose: () => void
	/** Accessible name; pass either label or labelledBy. */
	label?: string
	labelledBy?: string
	/** CSS data hook, e.g. 'modal' | 'drawer'. */
	surface?: string
	closeLabel?: string
	closeOnEscape?: boolean
	closeOnOutsideClick?: boolean
	children?: ReactNode
}

/**
 * Accessible, dependency-free overlay surface: backdrop + role=dialog/aria-modal, focus-trap,
 * scroll-lock, Escape/outside-click dismiss, initial focus, and focus restore on close. Composes the
 * exported primitives so a consumer can rebuild it from the same parts.
 */
export const DialogSurface = ({
	open,
	onClose,
	label,
	labelledBy,
	surface,
	closeLabel = 'Close',
	closeOnEscape,
	closeOnOutsideClick,
	children,
}: DialogSurfaceProps) => {
	const ref = useRef<HTMLDivElement>(null)
	const restoreRef = useRef<HTMLElement | null>(null)

	useScrollLock(open)
	useFocusTrap(ref, open)
	useDismiss({ active: open, onDismiss: onClose, closeOnEscape, closeOnOutsideClick }, ref)

	useEffect(() => {
		if (!open) {
			return
		}
		restoreRef.current =
			document.activeElement instanceof HTMLElement ? document.activeElement : null
		ref.current?.focus()
		return () => {
			restoreRef.current?.focus()
		}
	}, [open])

	if (!open) {
		return null
	}

	return createElement('div', { 'data-fb-overlay': surface ?? '' }, [
		// No onClick here: useDismiss already closes on an outside pointerdown (the backdrop is outside
		// the dialog ref), so wiring onClose here too would fire it twice per click and would ignore
		// closeOnOutsideClick. The backdrop stays purely presentational.
		createElement(Backdrop, { key: 'backdrop' }),
		createElement(
			'div',
			{
				key: 'surface',
				ref,
				role: 'dialog',
				'aria-modal': true,
				'aria-label': labelledBy ? undefined : label,
				'aria-labelledby': labelledBy,
				'data-fb-dialog': surface ?? '',
				tabIndex: -1,
			},
			[
				createElement(
					'button',
					{
						key: 'close',
						type: 'button',
						'data-fb-dialog-close': '',
						'aria-label': closeLabel,
						onClick: onClose,
					},
					'\xd7'
				),
				createElement('div', { key: 'body' }, children),
			]
		),
	])
}
