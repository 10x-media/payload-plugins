'use client'

import { type RefObject, useEffect, useLayoutEffect, useState } from 'react'

export type Direction = 'ltr' | 'rtl'

const useIsomorphicLayoutEffect = typeof window === 'undefined' ? useEffect : useLayoutEffect

/**
 * The direction an element reads in: the nearest `dir` attribute (Payload writes `<html dir>`,
 * in either case), else its computed `direction`.
 */
export const directionOf = (element: Element): Direction => {
	const declared = element.closest('[dir]')?.getAttribute('dir')?.toLowerCase()
	if (declared === 'rtl' || declared === 'ltr') {
		return declared
	}
	return getComputedStyle(element).direction === 'rtl' ? 'rtl' : 'ltr'
}

/**
 * The reading direction around `ref`, for what CSS cannot mirror (arrow keys, pointer sides). Starts
 * `ltr`, settles on mount and follows a language switch rewriting `<html dir>`.
 */
export const useDirection = (ref: RefObject<Element | null>): Direction => {
	const [direction, setDirection] = useState<Direction>('ltr')
	useIsomorphicLayoutEffect(() => {
		const element = ref.current
		if (!element) {
			return
		}
		const read = () => setDirection(directionOf(element))
		read()
		if (typeof MutationObserver === 'undefined') {
			return
		}
		const observer = new MutationObserver(read)
		observer.observe(document.documentElement, { attributes: true, attributeFilter: ['dir'] })
		return () => observer.disconnect()
	}, [ref])
	return direction
}

/**
 * Left and Right in reading order: `ArrowRight` is forward in a left-to-right page and back in a
 * right-to-left one. Null for every other key, Up and Down included, which mean the same either way.
 */
export const arrowStep = (key: string, direction: Direction): 1 | -1 | null => {
	if (key === 'ArrowRight') return direction === 'rtl' ? -1 : 1
	if (key === 'ArrowLeft') return direction === 'rtl' ? 1 : -1
	return null
}
