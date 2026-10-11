import type { PayloadComponent, ServerFunction, WidgetServerProps } from 'payload'
import { getFromImportMap } from 'payload/shared'
import type { ComponentType, ReactNode } from 'react'

import type { ChatSlotName } from '../client/components'
import { isDocumentId } from '../server/ids'
import { getInstance, resolveAccess } from '../server/service'
import { SLOT_FUNCTION_NAME } from '../shared/constants'
import { keys } from '../translations/keys'
import { asTranslate } from '../translations/server'
import type { ConversationMessage } from '../types'

export type SlotRequest = {
	channel?: string
	conversationKey?: string
	instance?: string
	messageId?: number | string
	slot?: ChatSlotName
	/** Which of the slot's components, in order. */
	slotIndex?: number
	type?: string
}

/** Props a server slot or message type component receives. */
export type ChatServerSlotProps = {
	channel?: string
	conversationKey: string
	instance: string
	message?: ConversationMessage
} & Pick<WidgetServerProps, 'locale' | 'permissions' | 'req'>

/**
 * Renders one server slot or message type component for a request from the
 * admin. Every call runs instance access for the conversation (and the
 * message's channel) before rendering anything, so a crafted request shows
 * nothing the user could not read through the endpoints.
 */
const renderSlot = async ({
	data,
	locale,
	permissions,
	req,
}: { data: SlotRequest } & Pick<
	WidgetServerProps,
	'locale' | 'permissions' | 'req'
>): Promise<ReactNode> => {
	if (!data.instance || !data.conversationKey || !req.user) return null

	const instance = getInstance(req, data.instance)
	const access = (await resolveAccess(req, instance, [data.conversationKey])).get(
		data.conversationKey
	)
	if (!access) return null

	let message: ConversationMessage | undefined
	if (data.messageId !== undefined) {
		if (!isDocumentId(req, instance.messagesSlug, data.messageId)) return null
		const found = (await req.payload.db.findOne({
			collection: instance.messagesSlug,
			where: { id: { equals: data.messageId } },
		})) as ConversationMessage | null
		if (
			!found ||
			found.key !== data.conversationKey ||
			!access.channels.some((channel) => channel.slug === found.channel)
		) {
			return null
		}
		message = found
	}

	const path: PayloadComponent | undefined = data.type
		? instance.types.get(data.type)?.Component
		: data.slot
			? instance.slots[data.slot][data.slotIndex ?? 0]
			: undefined
	if (!path) return null
	const Component = getFromImportMap<ComponentType<ChatServerSlotProps>>({
		importMap: req.payload.importMap,
		PayloadComponent: path,
		schemaPath: '',
		silent: true,
	})
	if (!Component) return null
	return (
		<Component
			channel={data.channel}
			conversationKey={data.conversationKey}
			instance={instance.slug}
			locale={locale}
			message={message}
			permissions={permissions}
			req={req}
		/>
	)
}

/**
 * WORKAROUND, and the default transport (`serverComponents: 'widget'`), the
 * same one settings-overlay uses. Server components for slots and message
 * types render after mount, which takes a Next server action, and Payload
 * funnels all of its own through one action declared in the host's generated
 * `app/(payload)/layout.tsx`, with no config-level way to add a name. Its
 * built-in `render-widget` renders a registered component with a real request
 * and caller data, which is all this needs. The cost is one
 * "Conversations (internal)" row in the dashboard's "Add widget" drawer; the
 * plugin registers it only when some instance has a server-capable component
 * and uses this transport.
 *
 * Because it sits in that drawer, someone can add it to their dashboard,
 * where it arrives with no `widgetData`. That is not a failed request and must
 * not read as one: it says the widget is not for display and can be removed.
 */
export const ConversationsSlotDispatcher = async (props: WidgetServerProps): Promise<ReactNode> => {
	const { locale, permissions, req, widgetData } = props
	const data = (widgetData ?? {}) as SlotRequest
	if (!data.instance || !data.conversationKey) {
		return <p className="conversations-widget-notice">{asTranslate(req.t)(keys.widgetNotice)}</p>
	}
	return renderSlot({ data, locale, permissions, req })
}

/**
 * The opt-in transport, for `serverComponents: 'server-function'`: the same
 * rendering through the plugin's own server function, registered by the host
 * in `app/(payload)/layout.tsx`. No dashboard widget then.
 */
export const conversationsRenderSlot: ServerFunction<
	SlotRequest,
	Promise<{ component: ReactNode }>
> = async ({ locale, permissions, req, ...data }) => ({
	component: await renderSlot({ data, locale, permissions, req }),
})

/**
 * Pass as `serverFunctions` to `handleServerFunctions` in
 * `app/(payload)/layout.tsx` (spread next to other plugins' functions).
 * Payload's own functions stay untouched; this adds one name beside them.
 */
export const conversationsServerFunctions = {
	[SLOT_FUNCTION_NAME]: conversationsRenderSlot,
} as unknown as Record<string, ServerFunction>
