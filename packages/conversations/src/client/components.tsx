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

/** Marks a slot entry that is a server component, rendered through `render-widget`. */
export const SERVER_SLOT = 'server'

/** One component of a slot: a client component, or `SERVER_SLOT`. */
export type ChatSlotEntry = ComponentType<ChatSlotProps> | typeof SERVER_SLOT

/** Config-level components, resolved on the server from the import map. */
export type ChatComponents = {
	/** Message types that are server components: rendered through `render-widget`. */
	server: { types: string[] }
	/** Each slot's components in order: the host's, then each extension's. */
	slots: Partial<Record<ChatSlotName, ChatSlotEntry[]>>
	types: Record<string, ComponentType<ChatSlotProps>>
}

const empty: ChatComponents = { server: { types: [] }, slots: {}, types: {} }

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
	slotIndex?: number
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
 * Renders a slot's configured components in order, client or server.
 * Nothing when the slot has none.
 */
export const ChatSlot = ({ name, ...props }: ChatSlotProps & { name: ChatSlotName }) => {
	const entries = useChatComponents(props.instance).slots[name]
	if (!entries || entries.length === 0) return null
	return (
		<>
			{entries.map((Entry, index) => {
				if (Entry !== SERVER_SLOT) {
					// biome-ignore lint/suspicious/noArrayIndexKey: slot entries are fixed per config and never reorder.
					return <Entry key={index} {...props} />
				}
				const request: WidgetRequest = {
					channel: props.channel,
					conversationKey: props.conversationKey,
					instance: props.instance,
					messageId: props.message?.id,
					slot: name,
					slotIndex: index,
				}
				return (
					<ServerRendered
						cacheKey={`${props.instance}:${name}:${index}:${props.conversationKey}:${props.channel ?? ''}:${String(props.message?.id ?? '')}:${props.message?.updatedAt ?? ''}`}
						// biome-ignore lint/suspicious/noArrayIndexKey: as above.
						key={index}
						request={request}
					/>
				)
			})}
		</>
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
