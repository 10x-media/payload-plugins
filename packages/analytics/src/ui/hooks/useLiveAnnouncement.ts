'use client'

import { useEffect, useRef, useState } from 'react'
import { monotonicMs } from '../../core/monotonic'

/** The least time between two announcements of one counter. */
export const ANNOUNCE_INTERVAL_MS = 60_000

/** The least time between two announcements on one page, whichever counters make them. */
export const TURN_GAP_MS = 5_000

/** When the page's next announcement may be made, shared by every counter on it. */
let nextTurn = Number.NEGATIVE_INFINITY

/**
 * How long a counter waits for its turn. A turn is never more than one gap off, so one further
 * off means the clock went back, and the turn is free.
 */
const turnWait = (now: number): number => {
	const wait = nextTurn - now
	return wait > 0 && wait <= TURN_GAP_MS ? wait : 0
}

/**
 * What a live region says of a polled value: changes only, at most once per `intervalMs` and only if
 * still changed then (3, 4, 3 says nothing), counters taking turns {@link TURN_GAP_MS} apart.
 */
export const useLiveAnnouncement = (
	message: string | null,
	intervalMs: number = ANNOUNCE_INTERVAL_MS
): string => {
	const [announced, setAnnounced] = useState('')
	const spoken = useRef<string | null>(null)
	const spokenAt = useRef(Number.NEGATIVE_INFINITY)

	useEffect(() => {
		if (message === null) {
			return
		}
		if (spoken.current === null) {
			spoken.current = message
			return
		}
		if (message === spoken.current) {
			return
		}
		let timer: ReturnType<typeof setTimeout> | undefined
		// A newer message clears this timer before it fires, so `message` is the latest one.
		const speak = (): void => {
			const now = monotonicMs()
			const turn = turnWait(now)
			if (turn > 0) {
				timer = setTimeout(speak, turn)
				return
			}
			nextTurn = now + TURN_GAP_MS
			spoken.current = message
			spokenAt.current = now
			setAnnounced(message)
		}
		const wait = spokenAt.current + intervalMs - monotonicMs()
		if (wait <= 0) {
			speak()
		} else {
			timer = setTimeout(speak, wait)
		}
		return () => clearTimeout(timer)
	}, [message, intervalMs])

	return announced
}
