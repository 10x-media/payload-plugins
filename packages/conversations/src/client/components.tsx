'use client'

import { useServerFunctions } from '@payloadcms/ui'
import {
	type ComponentProps,
	type ComponentType,
	createContext,
	type ReactNode,
	useContext,
	useEffect,
	useMemo,
	useRef,
	useState,
} from 'react'
import { useOptionalChatStore } from '../react/provider'
import { SLOT_FUNCTION_NAME, SLOT_WIDGET_SLUG } from '../shared/constants'
import type { AuthorsMap, ChatSlotConfig, ConversationMessage } from '../types'
import type { ChatChannelTabsProps } from './ChatChannelTabs'
import type { ChatComposerProps } from './ChatComposer'
import type { ChatDrawerProps, ChatPanelProps } from './ChatDrawer'
import type { ChatFeedProps } from './ChatFeed'
import type { ChatMessageProps } from './ChatMessage'
import type { ChatThreadProps } from './ChatThread'
import type { ChatTriggerProps } from './ChatTrigger'

export type ChatSlotName = keyof ChatSlotConfig

/** Props every configured slot and message type component receives. */
export type ChatSlotProps = {
	/** The authors map of the view, for message type components that name people. Client components only. */
	authors?: AuthorsMap
	channel?: string
	conversationKey: string
	instance: string
	message?: ConversationMessage
}

/** Marks a slot entry that is a server component, rendered through `render-widget`. */
export const SERVER_SLOT = 'server'

/** One component of a slot: a client component, or `SERVER_SLOT`. */
export type ChatSlotEntry = ComponentType<ChatSlotProps> | typeof SERVER_SLOT

/**
 * The built-in admin components a project can replace, each with the props of
 * the one it stands in for (`components` option, `ChatComponentsOverride`).
 */
export type ReplaceableComponents = {
	ChannelTabs: ComponentType<ChatChannelTabsProps>
	Composer: ComponentType<ChatComposerProps>
	Drawer: ComponentType<ChatDrawerProps>
	Feed: ComponentType<ChatFeedProps>
	Message: ComponentType<ChatMessageProps>
	Panel: ComponentType<ChatPanelProps>
	Thread: ComponentType<ChatThreadProps>
	Trigger: ComponentType<ChatTriggerProps>
}

export type ReplaceableName = keyof ReplaceableComponents

/** Config-level components, resolved on the server from the import map. */
export type ChatComponents = {
	/** Replacements for built-ins (`components` option). */
	replace: Partial<ReplaceableComponents>
	/**
	 * Message types that are server components, and how server components are
	 * fetched: Payload's `render-widget` (default) or the plugin's own server
	 * function, which the host registers (`serverComponents: 'server-function'`).
	 */
	server: { types: string[]; via?: 'server-function' | 'widget' }
	/** Each slot's components in order: the host's, then each extension's. */
	slots: Partial<Record<ChatSlotName, ChatSlotEntry[]>>
	types: Record<string, ComponentType<ChatSlotProps>>
}

const empty: ChatComponents = { replace: {}, server: { types: [] }, slots: {}, types: {} }

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
 * Payload throws a bare `Unknown Server Function: <name>` when a name is not
 * registered; say what to do instead.
 */
const explainMissingFunction = (error: unknown) => {
	const message = error instanceof Error ? error.message : String(error)
	if (message.includes('Unknown Server Function')) {
		console.error(
			`[@10x-media/conversations] the "${SLOT_FUNCTION_NAME}" server function is not registered. Either spread \`conversationsServerFunctions\` from @10x-media/conversations/rsc into \`handleServerFunctions\` in app/(payload)/layout.tsx, or drop \`serverComponents: 'server-function'\` to go back to the widget, which needs no wiring.`
		)
	}
	return null
}

/**
 * A server component slot, fetched after mount through Payload's
 * `render-widget` server function or the plugin's own (see
 * `rsc/SlotDispatcher`). Cached by the message's `updatedAt`, so an edit
 * renders afresh and a re-render does not.
 */
const ServerRendered = ({ cacheKey, request }: { cacheKey: string; request: WidgetRequest }) => {
	const { serverFunction } = useServerFunctions()
	const via = useChatComponents(request.instance).server.via ?? 'widget'
	const [node, setNode] = useState<ReactNode>(null)
	// The request is rebuilt every render; the cache key says when it really changed.
	const latest = useRef(request)
	latest.current = request
	useEffect(() => {
		let cancelled = false
		let pending = cache.get(cacheKey)
		if (!pending) {
			pending = (
				serverFunction(
					via === 'server-function'
						? { args: latest.current, name: SLOT_FUNCTION_NAME }
						: {
								args: { widgetData: latest.current, widgetSlug: SLOT_WIDGET_SLUG },
								name: 'render-widget',
							}
				) as Promise<{ component?: ReactNode }>
			)
				.then((result) => result?.component ?? null)
				.catch(explainMissingFunction)
			cache.set(cacheKey, pending)
		}
		void pending.then((value) => {
			if (!cancelled) setNode(value)
		})
		return () => {
			cancelled = true
		}
	}, [cacheKey, serverFunction, via])
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
	return (message: ConversationMessage, authors?: AuthorsMap): ReactNode => {
		const Client = components.types[message.type]
		if (Client) {
			return (
				<Client
					authors={authors}
					conversationKey={message.key}
					instance={instance}
					message={message}
				/>
			)
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

const OverrideContext = createContext<Partial<ReplaceableComponents>>({})

/** The built-ins currently drawn by their own replacement: inside it, the name means the default. */
const ReplacingContext = createContext<ReadonlySet<ReplaceableName>>(new Set())

/**
 * Replaces built-in components for everything below it, over the instance's
 * `components` option. React components, so it also works where there is no
 * import map. Nested overrides merge, the nearest winning.
 */
export const ChatComponentsOverride = ({
	children,
	components,
}: {
	children?: ReactNode
	components?: Partial<ReplaceableComponents>
}) => {
	const parent = useContext(OverrideContext)
	const value = useMemo(() => ({ ...parent, ...components }), [components, parent])
	return <OverrideContext.Provider value={value}>{children}</OverrideContext.Provider>
}

/**
 * A built-in that yields to a replacement: the nearest `ChatComponentsOverride`,
 * else the instance's `components` option, else `Default`. Inside its own
 * replacement the built-in draws `Default`, so a replacement can wrap it.
 */
export const replaceable = <K extends ReplaceableName>(
	name: K,
	Default: ReplaceableComponents[K]
): ReplaceableComponents[K] => {
	const Replaceable = (props: ComponentProps<ReplaceableComponents[K]>) => {
		const replacing = useContext(ReplacingContext)
		const local = useContext(OverrideContext)[name]
		const configured = useContext(ComponentsContext)
		const store = useOptionalChatStore()
		const instance = (props as { instance?: string }).instance ?? store?.instance
		const Replacement = replacing.has(name)
			? undefined
			: (local ?? (instance ? configured[instance]?.replace[name] : undefined))
		const inner = useMemo(() => new Set([...replacing, name]), [replacing])
		// biome-ignore lint/suspicious/noExplicitAny: each name carries its own props.
		const Component = (Replacement ?? Default) as ComponentType<any>
		if (!Replacement) return <Component {...props} />
		return (
			<ReplacingContext.Provider value={inner}>
				<Component {...props} />
			</ReplacingContext.Provider>
		)
	}
	Replaceable.displayName = `Chat${name}`
	return Replaceable as ReplaceableComponents[K]
}
