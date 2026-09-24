'use client'

import { useServerFunctions } from '@payloadcms/ui'
import {
	type ComponentType,
	createContext,
	type ReactNode,
	useContext,
	useEffect,
	useRef,
	useState,
} from 'react'
import { SLOT_WIDGET_SLUG } from '../shared/constants'
import type { ChatSlotConfig, ConversationMessage } from '../types'

export type ChatSlotName = keyof ChatSlotConfig

/** Props every configured slot and message type component receives. */
export type ChatSlotProps = {
	channel?: string
	conversationKey: string
	instance: string
	message?: ConversationMessage
}

/** Config-level components, resolved on the server from the import map. */
export type ChatComponents = {
	/** Slots and types that are server components: rendered through `render-widget`. */
	server: { slots: ChatSlotName[]; types: string[] }
	slots: Partial<Record<ChatSlotName, ComponentType<ChatSlotProps>>>
	types: Record<string, ComponentType<ChatSlotProps>>
}

const empty: ChatComponents = { server: { slots: [], types: [] }, slots: {}, types: {} }

const ComponentsContext = createContext<Record<string, ChatComponents>>({})

export const ChatComponentsProvider = ({
	children,
	components,
	instance,
}: {
	children?: ReactNode
	components?: ChatComponents
	instance: string
}) => {
	const parent = useContext(ComponentsContext)
	return (
		<ComponentsContext.Provider value={{ ...parent, [instance]: components ?? empty }}>
			{children}
		</ComponentsContext.Provider>
	)
}

export const useChatComponents = (instance: string): ChatComponents =>
	useContext(ComponentsContext)[instance] ?? empty

type WidgetRequest = {
	channel?: string
	conversationKey: string
	instance: string
	messageId?: number | string
	slot?: ChatSlotName
	type?: string
}

/** Rendered server nodes, per request, for the life of the page. */
const cache = new Map<string, Promise<ReactNode>>()

/**
 * A server component slot, fetched after mount through Payload's
 * `render-widget` server function (see `rsc/SlotDispatcher`). Cached by the
 * message's `updatedAt`, so an edit renders afresh and a re-render does not.
 */
const ServerRendered = ({ cacheKey, request }: { cacheKey: string; request: WidgetRequest }) => {
	const { serverFunction } = useServerFunctions()
	const [node, setNode] = useState<ReactNode>(null)
	// The request is rebuilt every render; the cache key says when it really changed.
	const latest = useRef(request)
	latest.current = request
	useEffect(() => {
		let cancelled = false
		let pending = cache.get(cacheKey)
		if (!pending) {
			pending = (
				serverFunction({
					args: { widgetData: latest.current, widgetSlug: SLOT_WIDGET_SLUG },
					name: 'render-widget',
				}) as Promise<{ component?: ReactNode }>
			)
				.then((result) => result?.component ?? null)
				.catch(() => null)
			cache.set(cacheKey, pending)
		}
		void pending.then((value) => {
			if (!cancelled) setNode(value)
		})
		return () => {
			cancelled = true
		}
	}, [cacheKey, serverFunction])
	return <>{node}</>
}

/**
 * Renders a configured slot, client or server. Nothing when the slot is not
 * configured.
 */
export const ChatSlot = ({ name, ...props }: ChatSlotProps & { name: ChatSlotName }) => {
	const components = useChatComponents(props.instance)
	const Client = components.slots[name]
	if (Client) return <Client {...props} />
	if (!components.server.slots.includes(name)) return null
	const request: WidgetRequest = {
		channel: props.channel,
		conversationKey: props.conversationKey,
		instance: props.instance,
		messageId: props.message?.id,
		slot: name,
	}
	return (
		<ServerRendered
			cacheKey={`${props.instance}:${name}:${props.conversationKey}:${props.channel ?? ''}:${String(props.message?.id ?? '')}:${props.message?.updatedAt ?? ''}`}
			request={request}
		/>
	)
}

/** Renders a custom message type's component, or null when none is registered. */
export const useTypeRenderer = (instance: string) => {
	const components = useChatComponents(instance)
	return (message: ConversationMessage): ReactNode => {
		const Client = components.types[message.type]
		if (Client) {
			return <Client conversationKey={message.key} instance={instance} message={message} />
		}
		if (!components.server.types.includes(message.type)) return null
		return (
			<ServerRendered
				cacheKey={`${instance}:type:${String(message.id)}:${message.updatedAt}`}
				request={{
					conversationKey: message.key,
					instance,
					messageId: message.id,
					type: message.type,
				}}
			/>
		)
	}
}
