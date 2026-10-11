'use client'

import { MoreIcon, Popup, PopupList } from '@payloadcms/ui'
import { createContext, type ReactNode, useContext, useState } from 'react'

import type { WindowMessage } from '../react/window'
import { TEXT_TYPE } from '../shared/constants'
import { keys } from '../translations/keys'
import { useTranslation } from '../translations/useTranslation'
import { ChatSlot, useChatComponents } from './components'

type MessageMenuContextValue = { close: () => void; message: WindowMessage }

const MessageMenuContext = createContext<MessageMenuContextValue | null>(null)

/**
 * Inside a message's menu: the message and `close`. For slot components in
 * `messageQuickActions` and `messageActions` that should close the menu
 * once they have done their thing. Null outside a menu.
 */
export const useMessageMenu = (): MessageMenuContextValue | null => useContext(MessageMenuContext)

/**
 * A message's "⋯" menu on Payload's own popup: an optional row of quick
 * actions (`messageQuickActions`, e.g. reactions), then Reply in thread,
 * Edit and Delete, then extension items (`messageActions`, the `actions`
 * prop). Renders nothing when the viewer has nothing to do with the message.
 */
export const MessageMenu = ({
	actions,
	instance,
	message,
	onDelete,
	onEdit,
	onOpenThread,
	own,
}: {
	actions?: ReactNode
	instance: string
	message: WindowMessage
	onDelete: () => void
	onEdit: () => void
	onOpenThread?: (message: WindowMessage) => void
	own: boolean
}) => {
	const { t } = useTranslation()
	const { slots } = useChatComponents(instance)
	const [open, setOpen] = useState(false)
	const quick = (slots.messageQuickActions?.length ?? 0) > 0
	const extra = Boolean(actions) || (slots.messageActions?.length ?? 0) > 0
	const canEdit = own && message.type === TEXT_TYPE
	if (!quick && !extra && !onOpenThread && !own) return null
	const slotProps = {
		channel: message.channel,
		conversationKey: message.key,
		instance,
		message,
	}
	return (
		<Popup
			button={
				<>
					<MoreIcon />
					<span className="conversations-sr-only">{t(keys.messageMenu)}</span>
				</>
			}
			buttonClassName="conversations-message__menu-button"
			buttonType="custom"
			caret={false}
			className={`conversations-message__menu${open ? ' conversations-message__menu--open' : ''}`}
			horizontalAlign="right"
			onToggleOpen={setOpen}
			render={({ close }) => (
				<MessageMenuContext.Provider value={{ close, message }}>
					{quick ? (
						<div className="conversations-message-menu__quick">
							<ChatSlot {...slotProps} name="messageQuickActions" />
						</div>
					) : null}
					<PopupList.ButtonGroup>
						{onOpenThread ? (
							<PopupList.Button
								onClick={() => {
									close()
									onOpenThread(message)
								}}
							>
								{t(keys.replyInThreadAction)}
							</PopupList.Button>
						) : null}
						{canEdit ? (
							<PopupList.Button
								onClick={() => {
									close()
									onEdit()
								}}
							>
								{t(keys.edit)}
							</PopupList.Button>
						) : null}
						{own ? (
							<PopupList.Button
								onClick={() => {
									close()
									onDelete()
								}}
							>
								{t(keys.delete)}
							</PopupList.Button>
						) : null}
						{actions}
						<ChatSlot {...slotProps} name="messageActions" />
					</PopupList.ButtonGroup>
				</MessageMenuContext.Provider>
			)}
			size="large"
			verticalAlign="bottom"
		/>
	)
}
