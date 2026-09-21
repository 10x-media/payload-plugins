'use client'

import type { Where } from 'payload'
import { createContext, type ReactNode, useContext } from 'react'

import type { ImpersonationStatus } from '../getImpersonation'

export type TargetFilterMap = Record<string, true | Where>

export type ImpersonationClientOptions = {
	apiPath: string
	cardEmail: boolean
	reasonMode: 'off' | 'optional' | 'required'
	sessionCollection: string
	status: ImpersonationStatus
	targets: TargetFilterMap
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
