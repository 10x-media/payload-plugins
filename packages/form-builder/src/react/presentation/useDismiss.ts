'use client'

import { type RefObject, useEffect } from 'react'

export type UseDismissOptions = {
	active: boolean
	onDismiss: () => void
	closeOnEscape?: boolean
	closeOnOutsideClick?: boolean
}

/** Dismiss-on-Escape and dismiss-on-outside-pointerdown for an overlay surface. */
export const useDismiss = (
	{ active, onDismiss, closeOnEscape = true, closeOnOutsideClick = true }: UseDismissOptions,
	ref: RefObject<HTMLElement | null>
): void => {
	useEffect(() => {
		if (!active) {
			return
		}
		const onKeyDown = (event: KeyboardEvent) => {
			if (closeOnEscape && event.key === 'Escape') {
				onDismiss()
			}
		}
		const onPointerDown = (event: Event) => {
			if (!closeOnOutsideClick) {
				return
			}
			const node = ref.current
			if (node && event.target instanceof Node && !node.contains(event.target)) {
				onDismiss()
			}
		}
		document.addEventListener('keydown', onKeyDown)
		document.addEventListener('pointerdown', onPointerDown)
		return () => {
			document.removeEventListener('keydown', onKeyDown)
			document.removeEventListener('pointerdown', onPointerDown)
		}
	}, [active, onDismiss, closeOnEscape, closeOnOutsideClick, ref])
}
