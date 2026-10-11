'use client'

import { useAuth } from '@payloadcms/ui'
import { useSyncExternalStore } from 'react'
import { useScopeToken } from './scopeTokenContext'
import { requestScopeKey } from './sharedCache'

// Cookies announce no change; each render takes a fresh snapshot instead.
const subscribe = (): (() => void) => () => {}

const cookieSnapshot = (): string => document.cookie

const serverSnapshot = (): string => ''

/**
 * The scope the pickers' shared reads key on: the surface's server-resolved token, else
 * {@link requestScopeKey} from the visible cookies, read each render. `''` while signed out.
 */
export const useRequestScope = (): string => {
	const { user } = useAuth()
	const token = useScopeToken()
	const cookies = useSyncExternalStore(subscribe, cookieSnapshot, serverSnapshot)
	const userKey = user?.id === undefined || user.id === null ? '' : String(user.id)
	if (userKey === '') {
		return ''
	}
	return token === undefined ? requestScopeKey(userKey, cookies) : `${userKey}@${token}`
}
