'use client'

import { createContext, type ReactNode, useContext, useEffect, useState } from 'react'

import { createApi } from './api'
import { ConversationsStore } from './store'
import { type ConversationsClientTransport, pollingTransport } from './transport'

const StoreContext = createContext<ConversationsStore | null>(null)

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
	return <StoreContext.Provider value={store}>{children}</StoreContext.Provider>
}

/** The store of the nearest `ChatProvider`. */
export const useChatStore = (): ConversationsStore => {
	const store = useContext(StoreContext)
	if (!store) {
		throw new Error('[@10x-media/conversations] hooks need a <ChatProvider> above them')
	}
	return store
}

/** The store of the nearest `ChatProvider`, or null outside one. */
export const useOptionalChatStore = (): ConversationsStore | null => useContext(StoreContext)
