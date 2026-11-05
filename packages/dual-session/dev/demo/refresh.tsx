'use client'

import { createContext, type ReactNode, useContext } from 'react'

const RefreshContext = createContext<() => void>(() => {})

/**
 * How the demo page reloads its server data after a login or an API call: `router.refresh()` on
 * Next.js, `router.invalidate()` on TanStack Start. Each app wraps the page in its own.
 */
export const RefreshProvider = ({
	children,
	refresh,
}: {
	children: ReactNode
	refresh: () => void
}) => <RefreshContext.Provider value={refresh}>{children}</RefreshContext.Provider>

export const useRefresh = () => useContext(RefreshContext)
