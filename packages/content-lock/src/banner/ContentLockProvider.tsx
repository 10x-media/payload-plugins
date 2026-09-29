'use client'

import {
	createContext,
	type Dispatch,
	type ReactNode,
	type SetStateAction,
	useContext,
	useEffect,
	useMemo,
	useState,
} from 'react'

import { isEntityLocked } from '../state/resolve'
import type { ContentLockState, EntityRef, LockWindow } from '../state/types'

/** What custom admin components can read about the lock. */
export type ContentLockContextValue = {
	/** The resolved lock, or `null` until the first admin page has rendered. */
	state: ContentLockState | null
	/** Whether any window is active. */
	locked: boolean
	/** Whether writes to `entity` are frozen. */
	isLocked: (entity: EntityRef) => boolean
	/** Known end of the lock, ISO, or `null` for a manual end or no lock. */
	endsAt: string | null
	/** The first active window, if any. */
	activeWindow: LockWindow | null
}

const StateContext = createContext<ContentLockContextValue | null>(null)
const SetterContext = createContext<Dispatch<SetStateAction<ContentLockState | null>> | null>(null)

/**
 * Holds the lock state for the admin. It sits in the root layout, which does
 * not re-render on navigation, so `ContentLockStateSync` feeds it fresh state
 * from the header on every page.
 */
export const ContentLockProvider = ({ children }: { children?: ReactNode }) => {
	const [state, setState] = useState<ContentLockState | null>(null)
	const value = useMemo<ContentLockContextValue>(
		() => ({
			state,
			locked: state?.locked ?? false,
			isLocked: (entity) => (state ? isEntityLocked(state, entity) : false),
			endsAt: state?.endsAt ?? null,
			activeWindow: state?.active[0] ?? null,
		}),
		[state]
	)
	return (
		<SetterContext.Provider value={setState}>
			<StateContext.Provider value={value}>{children}</StateContext.Provider>
		</SetterContext.Provider>
	)
}

/** Pushes the server-resolved state into the provider. Renders nothing. */
export const ContentLockStateSync = ({ state }: { state: ContentLockState }) => {
	const setState = useContext(SetterContext)
	useEffect(() => {
		setState?.(state)
	}, [setState, state])
	return null
}

const EMPTY: ContentLockContextValue = {
	state: null,
	locked: false,
	isLocked: () => false,
	endsAt: null,
	activeWindow: null,
}

/** The admin's view of the content lock. Safe outside the provider (reports unlocked). */
export const useContentLock = (): ContentLockContextValue => useContext(StateContext) ?? EMPTY
