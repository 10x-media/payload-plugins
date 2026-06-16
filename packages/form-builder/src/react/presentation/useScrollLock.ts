'use client'

import { useEffect } from 'react'

/** Lock body scroll while active; restores the prior value on cleanup. */
export const useScrollLock = (active: boolean): void => {
	useEffect(() => {
		if (!active) {
			return
		}
		const previous = document.body.style.overflow
		document.body.style.overflow = 'hidden'
		return () => {
			document.body.style.overflow = previous
		}
	}, [active])
}
