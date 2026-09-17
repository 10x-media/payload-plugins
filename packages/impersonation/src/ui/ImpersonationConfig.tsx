'use client'

import { createContext, type ReactNode, useContext } from 'react'

export type ImpersonationClientOptions = {
	apiPath: string
	reasonMode: 'off' | 'optional' | 'required'
}

const Context = createContext<ImpersonationClientOptions | null>(null)

export const ImpersonationClientConfig = ({
	children,
	value,
}: {
	children: ReactNode
	value: ImpersonationClientOptions
}) => <Context.Provider value={value}>{children}</Context.Provider>

export const useImpersonationClient = () => useContext(Context)
