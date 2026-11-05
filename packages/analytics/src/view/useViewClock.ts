'use client'

import { useCallback, useEffect, useState } from 'react'
import { viewerNow } from '../ui/viewerClock'

export interface ViewClock {
	/** The one instant every range, caption and relative label of a render reads. */
	now: Date
	/** Reads the clock again, as a refresh does. */
	tick: () => void
}

/**
 * View's one clock, held so captions and request keys stay stable; it moves on tab return or
 * refresh. Reads key on calendar days, so a same-day tick only updates relative labels.
 */
export const useViewClock = (): ViewClock => {
	const [now, setNow] = useState(viewerNow)
	const tick = useCallback(() => {
		setNow(viewerNow())
	}, [])

	useEffect(() => {
		const onVisible = (): void => {
			if (document.visibilityState !== 'hidden') {
				tick()
			}
		}
		document.addEventListener('visibilitychange', onVisible)
		return () => {
			document.removeEventListener('visibilitychange', onVisible)
		}
	}, [tick])

	return { now, tick }
}
