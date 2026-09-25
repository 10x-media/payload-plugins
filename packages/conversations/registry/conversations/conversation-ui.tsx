'use client'

import type { ComposerFeature } from '@10x-media/conversations/composer'
import type { WindowMessage } from '@10x-media/conversations/react'
import type { JSXConverters } from '@payloadcms/richtext-lexical/react'
import { type ComponentType, createContext, type ReactNode, useContext, useMemo } from 'react'

/** Every string the components show. Pass your own (or a translation) through `labels`. */
export const defaultLabels = {
	addReaction: 'Add reaction',
	cancel: 'Cancel',
	composerPlaceholder: 'Write a message…',
	couldNotLoad: 'Could not load messages.',
	couldNotSend: 'Could not send.',
	delete: 'Delete',
	deleteConfirm: 'Delete this message?',
	edit: 'Edit',
	edited: 'edited',
	empty: 'No messages yet.',
	enterToSend: 'Enter to send, Shift+Enter for a new line',
	jumpToLatest: 'Jump to latest',
	loadEarlier: 'Load earlier',
	messageDeleted: 'This message was deleted.',
	messageMenu: 'Message actions',
	newMessages: 'New messages',
	newReplies: 'new',
	readOnly: 'This conversation is read only.',
	replies: (count: number) => (count === 1 ? '1 reply' : `${count} replies`),
	replyInThread: 'Reply in thread',
	replyPlaceholder: 'Reply…',
	retry: 'Retry',
	save: 'Save',
	send: 'Send',
	sending: 'Sending…',
	switchTo: (channel: string) => `Switch to ${channel}`,
	textKept: 'Your text is kept.',
	thread: 'Thread',
	today: 'Today',
	unknownType: 'This message cannot be shown here.',
	unseen: (count: number) => `${count} new`,
	yesterday: 'Yesterday',
	you: 'You',
}

export type ConversationLabels = typeof defaultLabels

/** What extensions add to the components, as React components (no import map on a website). */
export type ConversationSlots = {
	/** Above the composer's editor. */
	composerAbove?: ComponentType<{ channel: string; conversationKey: string }>[]
	/** Items at the end of a message's menu. `close` shuts the menu. */
	messageActions?: ComponentType<{ close: () => void; message: WindowMessage }>[]
	/** Under a message's body, also on deleted placeholders (reactions outlive the text). */
	messageFooter?: ComponentType<{ message: WindowMessage }>[]
	/** A row at the top of a message's menu, e.g. quick reactions. */
	messageQuickActions?: ComponentType<{ close: () => void; message: WindowMessage }>[]
}

type ConversationUI = {
	/** The project's composer features, e.g. `[...defaultFeatures, textColorFeature()]`. */
	composerFeatures?: (args: { defaultFeatures: ComposerFeature[] }) => ComposerFeature[]
	/** JSX converters for message bodies: what those features store, shown. */
	converters?: JSXConverters
	labels: ConversationLabels
	/** Picks channel names and cues from localized config labels, and formats dates. */
	locale: string
	/** Draws message types other than `text`; return null for unknown ones. */
	renderType?: (message: WindowMessage) => ReactNode
	slots: ConversationSlots
}

const Context = createContext<ConversationUI>({ labels: defaultLabels, locale: 'en', slots: {} })

/**
 * Labels, locale, extension slots and custom message types for every
 * conversations component below it. Pass the site's own locale (from the
 * router, next-intl, ...) with `labels` in that language. Optional: without
 * it the components use English and no slots.
 */
export const ConversationUIProvider = ({
	children,
	composerFeatures,
	converters,
	labels,
	locale = 'en',
	renderType,
	slots,
}: {
	children?: ReactNode
	composerFeatures?: ConversationUI['composerFeatures']
	converters?: JSXConverters
	labels?: Partial<ConversationLabels>
	locale?: string
	renderType?: ConversationUI['renderType']
	slots?: ConversationSlots
}) => {
	const value = useMemo(
		() => ({
			composerFeatures,
			converters,
			labels: { ...defaultLabels, ...labels },
			locale,
			renderType,
			slots: slots ?? {},
		}),
		[composerFeatures, converters, labels, locale, renderType, slots]
	)
	return <Context.Provider value={value}>{children}</Context.Provider>
}

export const useConversationUI = (): ConversationUI => useContext(Context)
