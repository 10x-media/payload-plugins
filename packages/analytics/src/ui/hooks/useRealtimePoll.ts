'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import {
	isPollRefusalFinal,
	type RealtimeReading,
	readRealtimeReading,
} from '../../widgets/realtimePoll'
import { QueryFetchError, requestJson, retryOf } from '../data/request'

/** A poll that failed for now; `retryAfter` is in seconds, when the endpoint said. */
type Busy = { retryAfter?: number }

export interface RealtimePollOptions {
	/** The live endpoint's full URL for this counter, query string included. */
	url: string
	intervalMs: number
	/**
	 * A server-rendered reading. One with other numbers replaces the polled one; equal numbers in a new
	 * object, as an inline seed is each render, leave it alone.
	 */
	initial?: RealtimeReading
}

export interface RealtimePoll {
	/** The latest reading for this URL; null until the first one lands. */
	reading: RealtimeReading | null
	/** The last poll failed or carried no reading; the reading shown is the one before it. */
	paused: boolean
	/** Whether a read for this URL has settled, in either direction. */
	settled: boolean
	/**
	 * The last poll failed for now (an outage, a timeout, a full queue), not for want of a live
	 * count: worth saying so, and worth a retry.
	 */
	busy?: Busy
	/** Reads again at once. */
	retry: () => void
}

/** A failed poll the source may answer in a moment: anything but a refusal or a missing page. */
const busyOf = (err: unknown): Busy | undefined => {
	if (!(err instanceof QueryFetchError)) {
		return {}
	}
	return err.status === 429 || err.status >= 500 ? retryOf(err) : undefined
}

interface PollState {
	url: string
	/** What the seed said, so a seed rebuilt with the same numbers is the same seed. */
	seed: string
	reading: RealtimeReading | null
	paused: boolean
	settled: boolean
	busy?: Busy
}

const seedKeyOf = (seed: RealtimeReading | undefined): string =>
	seed === undefined ? '' : JSON.stringify(seed)

const fresh = (url: string, seed: RealtimeReading | undefined, seedKey: string): PollState => ({
	url,
	seed: seedKey,
	reading: seed ?? null,
	paused: false,
	settled: seed !== undefined,
})

const hidden = (): boolean =>
	typeof document !== 'undefined' && document.visibilityState === 'hidden'

/**
 * One live counter's poll, paused while the tab is hidden and resumed with an immediate read. A
 * `401` or `403` stops it for good; a new URL starts over with no reading.
 */
export const useRealtimePoll = ({
	url,
	intervalMs,
	initial,
}: RealtimePollOptions): RealtimePoll => {
	const seedKey = useMemo(() => seedKeyOf(initial), [initial])
	const [state, setState] = useState<PollState>(() => fresh(url, initial, seedKey))
	const current = state.url === url && state.seed === seedKey ? state : fresh(url, initial, seedKey)
	if (current !== state) {
		setState(current)
	}
	const needsFirstRead = current.reading === null
	const tickNow = useRef<() => void>(() => {})

	useEffect(() => {
		const controller = new AbortController()
		let timer: ReturnType<typeof setInterval> | undefined
		let stopped = false
		const pause = (): void => {
			if (timer !== undefined) clearInterval(timer)
			timer = undefined
		}
		const stop = (): void => {
			stopped = true
			pause()
		}
		const settle = (patch: { paused: boolean; reading?: RealtimeReading; busy?: Busy }): void => {
			setState((prev) => {
				if (prev.url !== url) {
					return prev
				}
				const { busy: _previous, ...rest } = prev
				return {
					...rest,
					...(patch.reading === undefined ? {} : { reading: patch.reading }),
					...(patch.busy === undefined ? {} : { busy: patch.busy }),
					paused: patch.paused,
					settled: true,
				}
			})
		}
		const tick = async (): Promise<void> => {
			try {
				const reading = readRealtimeReading(await requestJson(url, { signal: controller.signal }))
				if (controller.signal.aborted) return
				settle(reading === null ? { paused: true } : { reading, paused: false })
			} catch (err) {
				if (controller.signal.aborted) return
				if (isPollRefusalFinal(err)) stop()
				settle({ paused: true, busy: busyOf(err) })
			}
		}
		tickNow.current = () => {
			if (!stopped) void tick()
		}
		const resume = (): void => {
			if (!stopped && timer === undefined) {
				timer = setInterval(() => void tick(), intervalMs)
			}
		}
		const onVisibility = (): void => {
			if (stopped) return
			if (hidden()) {
				pause()
				return
			}
			resume()
			void tick()
		}
		if (needsFirstRead) {
			void tick()
		}
		if (!hidden()) {
			resume()
		}
		document.addEventListener('visibilitychange', onVisibility)
		return () => {
			controller.abort()
			stop()
			document.removeEventListener('visibilitychange', onVisibility)
		}
	}, [url, intervalMs, needsFirstRead])

	return {
		reading: current.reading,
		paused: current.paused,
		settled: current.settled,
		...(current.busy === undefined ? {} : { busy: current.busy }),
		retry: () => tickNow.current(),
	}
}
