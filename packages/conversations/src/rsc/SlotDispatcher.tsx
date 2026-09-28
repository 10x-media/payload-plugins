import type { PayloadComponent, WidgetServerProps } from 'payload'
import { getFromImportMap } from 'payload/shared'
import type { ComponentType, ReactNode } from 'react'

import type { ChatSlotName } from '../client/components'
import { isDocumentId } from '../server/ids'
import { getInstance, resolveAccess } from '../server/service'
import type { ConversationMessage } from '../types'

type SlotRequest = {
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
 * WORKAROUND, the same one settings-overlay uses: server components for
 * message types and slots render after mount, and Payload offers no
 * config-level way to add a server function. Its built-in `render-widget`
 * renders a registered component with a real request and caller data, which
 * is all this needs; the cost is one "Conversations (internal)" row in the
 * dashboard's "Add widget" drawer.
 *
 * Every call runs instance access for the conversation (and the message's
 * channel) before rendering anything, so a crafted request shows nothing the
 * user could not read through the endpoints.
 */
export const ConversationsSlotDispatcher = async (props: WidgetServerProps): Promise<ReactNode> => {
	const { locale, permissions, req, widgetData } = props
	const data = (widgetData ?? {}) as SlotRequest
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
