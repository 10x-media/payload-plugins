'use client'

import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { useCallback } from 'react'
import { serializeViewState, type ViewDefaults, type ViewState } from './state'

export interface ViewUrl {
	/** The address's query string, which Next keeps in step with every history write. */
	search: string
	/** A step the reader took, so Back undoes it. */
	push: (next: ViewState) => void
	/**
	 * A correction the reader never asked for, written as the query string it serializes to, so
	 * Back skips it. Returns a cancel for a correction that has yet to be written.
	 */
	replace: (query: string) => () => void
}

/**
 * Writes steps with the history API, which Next's router adopts without a server round trip; only
 * a scope change uses `router.push`, since scope is all the server must resolve again.
 */
export const useViewUrl = ({
	defaults,
	scope,
}: {
	defaults: ViewDefaults
	/** The scope token this render was resolved for. */
	scope: string | undefined
}): ViewUrl => {
	const router = useRouter()
	const pathname = usePathname()
	const search = useSearchParams().toString()
	const current = search === '' ? pathname : `${pathname}?${search}`

	const push = useCallback(
		(next: ViewState): void => {
			const query = serializeViewState(next, defaults).toString()
			const target = query === '' ? pathname : `${pathname}?${query}`
			if (next.scope !== scope) {
				router.push(target, { scroll: false })
				return
			}
			// Picking what is already showing is no step to go Back over.
			if (target !== current) {
				window.history.pushState(null, '', target)
			}
		},
		[current, defaults, pathname, router, scope]
	)

	const replace = useCallback(
		(query: string): (() => void) => {
			const target = query === '' ? pathname : `${pathname}?${query}`
			if (target === current) {
				return () => {}
			}
			// Router patches history in its own effect, after this view's on first render; written
			// earlier, the entry loses router state and `useSearchParams` never hears of it.
			const timer = setTimeout(() => {
				window.history.replaceState(null, '', target)
			}, 0)
			return () => {
				clearTimeout(timer)
			}
		},
		[current, pathname]
	)

	return { search, push, replace }
}
