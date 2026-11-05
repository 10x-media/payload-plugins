'use client'

import { useEffect, useRef } from 'react'

/**
 * Calls `dismiss` on Escape anywhere on the page while `active`, so content shown on hover can be
 * dismissed without moving the pointer (WCAG 1.4.13).
 */
export const useDismissOnEscape = (active: boolean, dismiss: () => void): void => {
	const latest = useRef(dismiss)
	useEffect(() => {
		latest.current = dismiss
	})
	useEffect(() => {
		if (!active) {
			return
		}
		const onKeyDown = (event: KeyboardEvent): void => {
			if (event.key === 'Escape') {
				latest.current()
			}
		}
		document.addEventListener('keydown', onKeyDown)
		return () => document.removeEventListener('keydown', onKeyDown)
	}, [active])
}
