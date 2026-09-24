'use client'

import type { Where } from 'payload'
import { createContext, type ReactNode, useContext, useEffect, useMemo, useState } from 'react'

import type { ImpersonationStatus } from '../getImpersonation'

export type TargetFilterMap = Record<string, true | Where>

export type ImpersonationClientOptions = {
	apiPath: string
	cardEmail: boolean
	reasonMode: 'off' | 'optional' | 'required'
	sessionCollection: string
	setStatus: (status: ImpersonationStatus) => void
	status: ImpersonationStatus
	targets: TargetFilterMap
}

type ServerClientOptions = Omit<ImpersonationClientOptions, 'setStatus'>

const Context = createContext<ImpersonationClientOptions | null>(null)

export const ImpersonationClientConfig = ({
	children,
	value,
}: {
	children: ReactNode
	value: ServerClientOptions
}) => {
	const [status, setStatus] = useState(value.status)
	useEffect(() => {
		setStatus(value.status)
	}, [value.status])
	const live = useMemo(() => ({ ...value, setStatus, status }), [status, value])
	return <Context.Provider value={live}>{children}</Context.Provider>
}

export const useImpersonationClient = () => useContext(Context)
