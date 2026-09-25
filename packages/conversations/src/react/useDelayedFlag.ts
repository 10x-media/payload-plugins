'use client'

import { useEffect, useRef, useState } from 'react'

/**
 * A loading flag that does not flicker: it turns on only after `delay` ms
 * of `active` (a fast answer shows no loading state at all), and once on it
 * stays on for at least `minVisible` ms.
 */
export const useDelayedFlag = (
	active: boolean,
	{ delay = 250, minVisible = 400 }: { delay?: number; minVisible?: number } = {}
): boolean => {
	const [on, setOn] = useState(false)
	const since = useRef(0)
	useEffect(() => {
		if (active && !on) {
			const timer = setTimeout(() => {
				since.current = Date.now()
				setOn(true)
			}, delay)
			return () => clearTimeout(timer)
		}
		if (!active && on) {
			const left = minVisible - (Date.now() - since.current)
			if (left <= 0) {
				setOn(false)
				return
			}
			const timer = setTimeout(() => setOn(false), left)
			return () => clearTimeout(timer)
		}
	}, [active, delay, minVisible, on])
	return on
}
