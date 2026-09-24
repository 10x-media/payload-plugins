'use client'

import { Drawer, useModal } from '@payloadcms/ui'
import { type ReactNode, useEffect, useState } from 'react'

import { resolveLabel, useChannels, useConversation } from '../react/hooks'
import type { WindowMessage } from '../react/window'
import { keys } from '../translations/keys'
import { useTranslation } from '../translations/useTranslation'
import { ChatChannelTabs } from './ChatChannelTabs'
import { ChatComposer } from './ChatComposer'
import { ChatFeed } from './ChatFeed'
import { ChatThread } from './ChatThread'

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
	return (
		<div className="conversations-drawer__header">
			<div className="conversations-drawer__heading">
				<h2 className="conversations-drawer__title">{title}</h2>
				{subtitle ? <div className="conversations-drawer__subtitle">{subtitle}</div> : null}
				{children}
			</div>
			<button
				aria-label={t(keys.close)}
				className="conversations-icon-button conversations-drawer__close"
				onClick={onClose}
				type="button"
			>
				×
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
	const { channels, reads, viewer } = useChannels(conversationKey)
	const [active, setActive] = useState<null | string>(null)
	const [thread, setThread] = useState<null | WindowMessage>(null)
	const current = channels.find((channel) => channel.slug === active) ?? channels[0]
	const conversation = useConversation({ channel: current?.slug, key: conversationKey })
	const threadSlug = `${drawerSlug}-thread`

	useEffect(() => {
		if (thread) openModal(threadSlug)
	}, [openModal, thread, threadSlug])

	const label = current ? resolveLabel(current.label, i18n.language) : ''
	const cue =
		current && (channels.length > 1 || current.cue)
			? (current.cue ?? { label: current.label, tone: 'neutral' as const })
			: null
	return (
		<div className="conversations-drawer">
			<DrawerHeader
				onClose={() => closeModal(drawerSlug)}
				subtitle={subtitle}
				title={title ?? t(keys.comments)}
			>
				{header}
			</DrawerHeader>
			<ChatChannelTabs
				active={current?.slug ?? ''}
				channels={channels}
				onChange={setActive}
				reads={reads}
			/>
			{current ? (
				<>
					<ChatFeed
						conversation={conversation}
						empty={t(keys.emptyChannel, { channel: label })}
						instance={instance}
						key={`feed:${current.slug}`}
						onOpenThread={setThread}
						renderType={renderType}
					/>
					<ChatComposer
						channel={current.slug}
						conversationKey={conversationKey}
						cue={cue}
						disabledReason={current.canCreate ? undefined : t(keys.readOnlyChannel)}
						instance={instance}
						key={`composer:${current.slug}`}
						submitLabel={channels.length > 1 ? t(keys.sendTo, { channel: label }) : undefined}
					/>
				</>
			) : (
				<div className="conversations-feed__skeleton" />
			)}
			{thread && current ? (
				<Drawer
					className="conversations-drawer-shell"
					gutter={false}
					Header={null}
					slug={threadSlug}
				>
					<div className="conversations-drawer">
						<DrawerHeader
							onClose={() => {
								closeModal(threadSlug)
								setThread(null)
							}}
							subtitle={label}
							title={t(keys.thread)}
						/>
						<ChatThread
							authors={conversation.authors}
							channel={current}
							instance={instance}
							renderType={renderType}
							root={conversation.messages.find((message) => message.id === thread.id) ?? thread}
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
	<Drawer
		className="conversations-drawer-shell"
		gutter={false}
		Header={null}
		slug={props.drawerSlug}
	>
		<DrawerBody {...props} />
	</Drawer>
)
