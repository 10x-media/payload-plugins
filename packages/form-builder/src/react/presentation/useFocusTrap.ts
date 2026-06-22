'use client'

import { type RefObject, useEffect } from 'react'

const FOCUSABLE =
	'a[href],button:not([disabled]),textarea:not([disabled]),input:not([disabled]),select:not([disabled]),[tabindex]:not([tabindex="-1"])'

/** Trap Tab focus within the container while active. */
export const useFocusTrap = (ref: RefObject<HTMLElement | null>, active: boolean): void => {
	useEffect(() => {
		if (!active) {
			return
		}
		const node = ref.current
		if (!node) {
			return
		}
		const onKeyDown = (event: KeyboardEvent) => {
			if (event.key !== 'Tab') {
				return
			}
			const focusable = Array.from(node.querySelectorAll<HTMLElement>(FOCUSABLE))
			if (focusable.length === 0) {
				return
			}
			const first = focusable[0] as HTMLElement
			const last = focusable[focusable.length - 1] as HTMLElement
			const activeEl = document.activeElement
			if (event.shiftKey && activeEl === first) {
				event.preventDefault()
				last.focus()
			} else if (!event.shiftKey && activeEl === last) {
				event.preventDefault()
				first.focus()
			}
		}
		node.addEventListener('keydown', onKeyDown)
		return () => {
			node.removeEventListener('keydown', onKeyDown)
		}
	}, [ref, active])
}
