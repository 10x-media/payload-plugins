'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { failureOf, isAbortError, type RequestFailure } from './request'

/**
 * One keyed read as a surface renders it. `data` may be the previous answer while loading or failed
 * (see {@link UseRequestOptions.keep}); `isRefetching` flags that load for a subtle busy cue.
 *
 * @beta
 */
export interface RequestState<T> {
	status: 'loading' | 'ok' | 'error'
	data?: T
	error?: RequestFailure
	isRefetching: boolean
	refetch: () => void
}

export interface RunContext {
	signal: AbortSignal
	/** Reading a server-rendered answer again in the background, rather than a read of its own. */
	revalidating: boolean
}

export interface UseRequestOptions<T> {
	/**
	 * The read's identity: a new key aborts the read in flight and issues the next, the same key never
	 * refetches, and null reads as `unsupported`.
	 */
	key: string | null
	run: (context: RunContext) => Promise<T>
	/**
	 * What an answer is about: while unchanged the last answer stays up until the next lands; once it
	 * changes the old answer drops in the same render, so no number shows under the wrong name.
	 */
	keep?: string
	/**
	 * An answer the server already rendered for `key`, read once on mount. A `stale` one is shown
	 * at once and read again quietly: no busy state while that runs, and it stays if that fails.
	 */
	seed?: { key: string; data: T; stale?: boolean }
}

interface Entry<T> {
	key: string | null
	keep: string
	status: 'loading' | 'ok' | 'error'
	data?: T
	error?: RequestFailure
}

const UNSUPPORTED: RequestFailure = { code: 'unsupported' }

/** The previous answer, carried into the next entry only while it is about the same `keep`. */
const keptData = <T>(prev: Entry<T>, keep: string): Pick<Entry<T>, 'data'> =>
	prev.keep === keep && prev.data !== undefined ? { data: prev.data } : {}

/**
 * A keyed request with abort, the previous answer and `refetch`, derived from the current key so the
 * render in which the key changes already shows loading.
 */
export const useRequest = <T>(options: UseRequestOptions<T>): RequestState<T> => {
	const { key, keep = '', seed } = options
	const [entry, setEntry] = useState<Entry<T>>(() =>
		seed === undefined
			? { key: null, keep, status: 'loading' }
			: { key: seed.key, keep, status: 'ok', data: seed.data }
	)
	const run = useRef(options.run)
	const latest = useRef({ key, keep })
	const pending = useRef<AbortController | null>(null)
	// The seed answers its own key until the read moves off it; a remount in StrictMode must not
	// count as moving.
	const seeded = useRef(seed === undefined ? undefined : { key: seed.key, stale: seed.stale })

	useEffect(() => {
		run.current = options.run
		latest.current = { key, keep }
	})

	const issue = useCallback((target: string, targetKeep: string, revalidating: boolean): void => {
		pending.current?.abort()
		const controller = new AbortController()
		pending.current = controller
		if (!revalidating) {
			// A render already derives `loading` for a new key, so an entry still loading needs no
			// update, which spares a first read its second render.
			setEntry((prev) =>
				prev.status === 'loading'
					? prev
					: {
							key: target,
							keep: targetKeep,
							status: 'loading',
							...keptData(prev, targetKeep),
						}
			)
		}
		run.current({ signal: controller.signal, revalidating }).then(
			(data) => {
				if (!controller.signal.aborted) {
					setEntry({ key: target, keep: targetKeep, status: 'ok', data })
				}
			},
			(err: unknown) => {
				// A background read that failed leaves the seed on screen, unannounced.
				if (controller.signal.aborted || isAbortError(err) || revalidating) {
					return
				}
				setEntry((prev) => ({
					key: target,
					keep: targetKeep,
					status: 'error',
					error: failureOf(err),
					...keptData(prev, targetKeep),
				}))
			}
		)
	}, [])

	useEffect(() => {
		if (key === null) {
			pending.current?.abort()
			pending.current = null
			return
		}
		const seedFor = seeded.current
		if (seedFor !== undefined && seedFor.key === key) {
			if (seedFor.stale === true) {
				issue(key, keep, true)
			}
		} else {
			seeded.current = undefined
			issue(key, keep, false)
		}
		return () => {
			pending.current?.abort()
		}
	}, [key, keep, issue])

	// The key as of the last commit, never the one this callback was made under: a caller holding
	// an older `refetch` (a refresh that moved the clock past midnight) still asks for today's read.
	const refetch = useCallback(() => {
		const now = latest.current
		if (now.key !== null) {
			seeded.current = undefined
			issue(now.key, now.keep, false)
		}
	}, [issue])

	if (key === null) {
		return { status: 'error', error: UNSUPPORTED, isRefetching: false, refetch }
	}
	const current: Entry<T> =
		entry.key === key && entry.keep === keep
			? entry
			: {
					key,
					keep,
					status: 'loading',
					...keptData(entry, keep),
				}
	return {
		status: current.status,
		...(current.data === undefined ? {} : { data: current.data }),
		...(current.error === undefined ? {} : { error: current.error }),
		isRefetching: current.status === 'loading' && current.data !== undefined,
		refetch,
	}
}
