'use client'

import { createContext, type ReactNode, useContext } from 'react'

const ScopeTokenContext = createContext<string | undefined>(undefined)

export interface AnalyticsScopeTokenProviderProps {
	/** The server's token for the request's user and scope; undefined leaves pages to their cookies. */
	token: string | undefined
	children?: ReactNode
}

/** Hands one analytics surface the token its server component resolved (`WithScopeToken`). */
export function AnalyticsScopeTokenProvider({ token, children }: AnalyticsScopeTokenProviderProps) {
	return <ScopeTokenContext.Provider value={token}>{children}</ScopeTokenContext.Provider>
}

/** The server's scope token for this page, undefined where no provider rendered one. */
export const useScopeToken = (): string | undefined => useContext(ScopeTokenContext)
