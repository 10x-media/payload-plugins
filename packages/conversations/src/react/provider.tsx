'use client'

import { createContext, type ReactNode, useContext, useEffect, useMemo, useState } from 'react'

import { createApi } from './api'
import { ConversationsStore } from './store'
import { type ConversationsClientTransport, pollingTransport } from './transport'

type ContextValue = {
	/** Every provider above, by instance, so a subtree can pick one with `ChatScope`. */
	all: ReadonlyMap<string, ConversationsStore>
	/** The nearest provider's store. */
	store: ConversationsStore
}

const StoreContext = createContext<ContextValue | null>(null)

export type ChatProviderProps = {
	/** Payload's API route. Default `/api`. */
	apiRoute?: string
	children?: ReactNode
	/** Replaces `fetch`, e.g. to add an Authorization header outside the admin. */
	fetch?: (input: string, init: RequestInit) => Promise<Response>
	/** The instance slug: `conversations({ slug })`. */
	instance: string
	/** Prefix for the API, for a website on another origin. Default same origin. */
	serverURL?: string
	/** Default `pollingTransport()`. */
	transport?: ConversationsClientTransport
}

/**
 * Scopes the hooks below it to one instance. Headless: renders nothing of its
 * own and imports nothing from `@payloadcms/ui`, so it works on a website.
 * Several providers (one per instance) can be nested.
 */
export const ChatProvider = ({
	apiRoute,
	children,
	fetch,
	instance,
	serverURL,
	transport,
}: ChatProviderProps) => {
	const parent = useContext(StoreContext)
	const [store] = useState(
		() =>
			new ConversationsStore({
				api: createApi({ apiRoute, fetch, instance, serverURL }),
				instance,
				transport: transport ?? pollingTransport(),
			})
	)
	useEffect(() => {
		store.connect()
		return () => store.disconnect()
	}, [store])
	const value = useMemo(
		() => ({ all: new Map([...(parent?.all ?? []), [instance, store]]), store }),
		[instance, parent, store]
	)
	return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>
}

/**
 * Re-scopes the hooks below it to another instance's provider further up. For
 * components that know their instance (`clientProps: { instance }`) and may
 * sit under several providers.
 */
export const ChatScope = ({ children, instance }: { children?: ReactNode; instance: string }) => {
	const parent = useContext(StoreContext)
	const store = parent?.all.get(instance)
	const value = useMemo(
		() => (parent && store ? { all: parent.all, store } : null),
		[parent, store]
	)
	if (!value) {
		return null
	}
	return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>
}

/** The store of the nearest `ChatProvider`. */
export const useChatStore = (): ConversationsStore => {
	const context = useContext(StoreContext)
	if (!context) {
		throw new Error('[@10x-media/conversations] hooks need a <ChatProvider> above them')
	}
	return context.store
}

/** The store of the nearest `ChatProvider`, or null outside one. */
export const useOptionalChatStore = (instance?: string): ConversationsStore | null => {
	const context = useContext(StoreContext)
	if (!context) return null
	return instance ? (context.all.get(instance) ?? null) : context.store
}
