'use client'

import {
	ChatChannelTabs,
	type ChatChannelTabsProps,
	ChatComposer,
	type ChatComposerProps,
	ChatDrawer,
	type ChatDrawerProps,
	ChatFeed,
	type ChatFeedProps,
	ChatMessage,
	type ChatMessageProps,
	ChatPanel,
	type ChatPanelProps,
	ChatThread,
	type ChatThreadProps,
	ChatTrigger,
	type ChatTriggerProps,
} from '@10x-media/conversations/client'
import type { CSSProperties, ReactNode } from 'react'
import './replaced.css'

/**
 * The `notes` instance replaces every built-in with these. Each wraps the
 * default in a labelled outline, so the page shows which component a
 * replacement drew and that the nesting still works.
 */
const Marked = ({
	children,
	color,
	name,
}: {
	children: ReactNode
	color: string
	name: string
}) => (
	<div className="replaced" style={{ '--replaced-color': color } as CSSProperties}>
		<span className="replaced__label">{name}</span>
		{children}
	</div>
)

export const ReplacedTrigger = (props: ChatTriggerProps) => (
	<Marked color="#e11d48" name="Trigger">
		<ChatTrigger {...props} />
	</Marked>
)

export const ReplacedDrawer = (props: ChatDrawerProps) => (
	<ChatDrawer
		{...props}
		header={<span className="replaced__badge">Drawer replaced</span>}
		title="Project notes"
	/>
)

export const ReplacedPanel = (props: ChatPanelProps) => (
	<Marked color="#7c3aed" name="Panel">
		<ChatPanel {...props} />
	</Marked>
)

export const ReplacedChannelTabs = (props: ChatChannelTabsProps) => (
	<Marked color="#0891b2" name="ChannelTabs">
		<ChatChannelTabs {...props} />
	</Marked>
)

export const ReplacedFeed = (props: ChatFeedProps) => (
	<Marked color="#16a34a" name="Feed">
		<ChatFeed {...props} />
	</Marked>
)

/** Fills the default's prop slots: a header of its own and a footer line. */
export const ReplacedMessage = (props: ChatMessageProps) => (
	<ChatMessage
		{...props}
		footer={
			<span className="replaced__footer">Message replaced · #{String(props.message.id)}</span>
		}
		header={
			props.compact ? undefined : (
				<div className="replaced__header">
					{props.authors[props.message.authorKey]?.name ?? 'Someone'}
					<span className="replaced__badge">Message</span>
				</div>
			)
		}
	/>
)

export const ReplacedComposer = (props: ChatComposerProps) => (
	<Marked color="#ea580c" name={props.initialBody ? 'Composer (editing)' : 'Composer'}>
		<ChatComposer {...props} submitOn="mod+enter" />
	</Marked>
)

export const ReplacedThread = (props: ChatThreadProps) => (
	<Marked color="#ca8a04" name="Thread">
		<ChatThread {...props} />
	</Marked>
)
