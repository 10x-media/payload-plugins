'use client'

import { useAuth } from '@payloadcms/ui'
import type { Where } from 'payload'
import {
	createContext,
	type ReactNode,
	useCallback,
	useContext,
	useEffect,
	useMemo,
	useState,
} from 'react'

import type { ImpersonationStatus } from '../getImpersonation'
import { viewerKey } from '../ids'

export type TargetFilterMap = Record<string, true | Where>

export type ImpersonationClientOptions = {
	apiPath: string
	cardEmail: boolean
	reasonMode: 'off' | 'optional' | 'required'
	sessionCollection: string
	setStatus: (status: ImpersonationStatus) => void
	/** Stores the filters resolved for `viewer`, a `viewerKey`. */
	setTargetFilters: (viewer: null | string, targetFilters: TargetFilterMap) => void
	status: ImpersonationStatus
	targetFilters: TargetFilterMap
}

type ServerClientOptions = Omit<ImpersonationClientOptions, 'setStatus' | 'setTargetFilters'> & {
	viewer: null | string
}

const NO_TARGETS: TargetFilterMap = {}

const Context = createContext<ImpersonationClientOptions | null>(null)

/**
 * Holds the plugin's client state. It sits in the root layout, which renders once on the login
 * page and not again after login, so `ImpersonationTargetsHeader` feeds it the signed-in viewer's
 * target filters on every page.
 */
export const ImpersonationClientConfig = ({
	children,
	value,
}: {
	children: ReactNode
	value: ServerClientOptions
}) => {
	const { user } = useAuth()
	const [status, setStatus] = useState(value.status)
	useEffect(() => {
		setStatus(value.status)
	}, [value.status])
	const [targets, setTargets] = useState({ filters: value.targetFilters, viewer: value.viewer })
	const setTargetFilters = useCallback((viewer: null | string, filters: TargetFilterMap) => {
		// Every page sends a fresh object; keeping the stored one spares the document button a refetch.
		setTargets((current) =>
			current.viewer === viewer && JSON.stringify(current.filters) === JSON.stringify(filters)
				? current
				: { filters, viewer }
		)
	}, [])
	// Login and logout are client-side navigations to pages without the header, so until it syncs
	// again the stored filters may belong to the previous viewer.
	const viewer = viewerKey(user)
	const targetFilters = targets.viewer === viewer ? targets.filters : NO_TARGETS
	const live = useMemo(
		() => ({ ...value, setStatus, setTargetFilters, status, targetFilters }),
		[setTargetFilters, status, targetFilters, value]
	)
	return <Context.Provider value={live}>{children}</Context.Provider>
}

/** Pushes the server-resolved target filters into the provider. Renders nothing. */
export const ImpersonationTargetsSync = ({
	targetFilters,
	viewer,
}: {
	targetFilters: TargetFilterMap
	viewer: null | string
}) => {
	const setTargetFilters = useContext(Context)?.setTargetFilters
	useEffect(() => {
		setTargetFilters?.(viewer, targetFilters)
	}, [setTargetFilters, targetFilters, viewer])
	return null
}

export const useImpersonationClient = () => useContext(Context)
