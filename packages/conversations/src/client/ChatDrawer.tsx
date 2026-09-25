'use client'

import { Drawer, useModal, XIcon } from '@payloadcms/ui'
import type { ReactNode } from 'react'

import { resolveLabel } from '../react/hooks'
import { useChatPanel } from '../react/useChatPanel'
import type { WindowMessage } from '../react/window'
import { keys } from '../translations/keys'
import { useTranslation } from '../translations/useTranslation'
import { ChatChannelTabs } from './ChatChannelTabs'
import { ChatComposer } from './ChatComposer'
import { ChatFeed } from './ChatFeed'
import { ChatThread } from './ChatThread'
import { ChatSlot } from './components'

export type ChatDrawerProps = {
	conversationKey: string
	/** The Payload modal slug this drawer opens under. */
	drawerSlug: string
	/** Slot: extra content in the header, after the title. */
	header?: ReactNode
	instance: string
	/** Renders messages whose `type` is not `text`. */
	renderType?: (message: WindowMessage) => ReactNode
	/** A line under the title, e.g. the document's title. */
	subtitle?: ReactNode
	title?: ReactNode
}

const DrawerHeader = ({
	onClose,
	subtitle,
	title,
	children,
}: {
	children?: ReactNode
	onClose: () => void
	subtitle?: ReactNode
	title: ReactNode
}) => {
	const { t } = useTranslation()
	// Payload's own drawer header markup and classes, plus a line under the title.
	return (
		<div className="drawer__header conversations-drawer__header">
			<div className="conversations-drawer__heading">
				<h2 className="drawer__header__title conversations-drawer__title">{title}</h2>
				{subtitle ? <div className="conversations-drawer__subtitle">{subtitle}</div> : null}
				{children}
			</div>
			<button
				aria-label={t(keys.close)}
				className="drawer__header__close"
				onClick={onClose}
				type="button"
			>
				<XIcon />
			</button>
		</div>
	)
}

const DrawerBody = ({
	conversationKey,
	drawerSlug,
	header,
	instance,
	renderType,
	subtitle,
	title,
}: ChatDrawerProps) => {
	const { i18n, t } = useTranslation()
	const { closeModal, openModal } = useModal()
	const panel = useChatPanel({ conversationKey })
	const { channels, conversation, current, other, reads, thread, viewer } = panel
	const threadSlug = `${drawerSlug}-thread`

	// Opened from the click, not from an effect on `thread`: Escape and a click
	// outside close the modal without clearing `thread`, and reopening the same
	// thread would then change nothing an effect could see.
	const openThread = (message: WindowMessage) => {
		panel.openThread(message)
		openModal(threadSlug)
	}

	const label = current ? resolveLabel(current.label, i18n.language) : ''
	const cue = current?.cue ?? null
	return (
		<div className="conversations-drawer">
			<DrawerHeader
				onClose={() => closeModal(drawerSlug)}
				subtitle={subtitle}
				title={title ?? t(keys.comments)}
			>
				{header}
				<ChatSlot
					channel={current?.slug}
					conversationKey={conversationKey}
					instance={instance}
					name="drawerHeader"
				/>
			</DrawerHeader>
			<ChatChannelTabs
				active={current?.slug ?? ''}
				channels={channels}
				onChange={panel.setChannel}
				reads={reads}
			/>
			{current ? (
				<>
					<ChatFeed
						conversation={conversation}
						empty={t(keys.emptyChannel, { channel: label })}
						instance={instance}
						key={`feed:${current.slug}`}
						onOpenThread={openThread}
						readOnly={!current.canCreate}
						renderType={renderType}
					/>
					<ChatComposer
						channel={current.slug}
						conversationKey={conversationKey}
						cue={cue}
						cueAction={
							other
								? {
										label: t(keys.switchTo, { channel: resolveLabel(other.label, i18n.language) }),
										onClick: () => panel.setChannel(other.slug),
									}
								: null
						}
						disabledReason={current.canCreate ? undefined : t(keys.readOnlyChannel)}
						instance={instance}
						key={`composer:${current.slug}`}
					/>
				</>
			) : panel.loading ? (
				<div className="conversations-feed__skeleton" />
			) : null}
			{thread && current ? (
				<Drawer className="conversations-drawer-shell" Header={null} slug={threadSlug}>
					<div className="conversations-drawer">
						<DrawerHeader
							onClose={() => {
								closeModal(threadSlug)
								panel.closeThread()
							}}
							subtitle={label}
							title={t(keys.thread)}
						/>
						<ChatThread
							authors={conversation.authors}
							channel={current}
							instance={instance}
							renderType={renderType}
							root={thread}
							viewer={viewer}
						/>
					</div>
				</Drawer>
			) : null}
		</div>
	)
}

/**
 * The conversation of one target in a Payload drawer: header, channel tabs,
 * feed, composer. A thread opens as a second drawer stacked on top.
 */
export const ChatDrawer = (props: ChatDrawerProps) => (
	<Drawer className="conversations-drawer-shell" Header={null} slug={props.drawerSlug}>
		<DrawerBody {...props} />
	</Drawer>
)
