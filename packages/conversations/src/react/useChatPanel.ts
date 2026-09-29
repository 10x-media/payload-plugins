'use client'

import { useState } from 'react'

import { type ChannelView, type UseConversationResult, useChannels, useConversation } from './hooks'
import { useDelayedFlag } from './useDelayedFlag'
import type { WindowMessage } from './window'

export type UseChatPanelResult = {
	/** The readable channels, in instance order. */
	channels: ChannelView[]
	/** Close the thread. */
	closeThread: () => void
	/** The feed of the current channel. */
	conversation: UseConversationResult
	/** The channel shown: the one picked, else the first. */
	current: ChannelView | undefined
	/** Open a message's thread. */
	openThread: (message: WindowMessage) => void
	/** With exactly two channels, the other one: a "Switch to" shortcut instead of tabs. */
	other: ChannelView | undefined
	reads: boolean
	/** Show that channels are one moment away (a slow subscribe only). */
	loading: boolean
	setChannel: (slug: string) => void
	/** The open thread's root, kept current as the feed updates; null when none is open. */
	thread: null | WindowMessage
	viewer: null | string
}

/**
 * The state of one conversation's panel, for any markup: its channels and the
 * one shown, that channel's feed, and the open thread. The admin drawer and a
 * website panel both draw this.
 */
export const useChatPanel = ({
	conversationKey,
}: {
	conversationKey: string
}): UseChatPanelResult => {
	const { channels, reads, viewer } = useChannels(conversationKey, { count: false })
	const [active, setActive] = useState<null | string>(null)
	const [thread, setThread] = useState<null | WindowMessage>(null)
	const current = channels.find((channel) => channel.slug === active) ?? channels[0]
	const loading = useDelayedFlag(!current)
	const conversation = useConversation({ channel: current?.slug, key: conversationKey })
	return {
		channels,
		closeThread: () => setThread(null),
		conversation,
		current,
		loading,
		openThread: setThread,
		other: channels.length === 2 ? channels.find((channel) => channel !== current) : undefined,
		reads,
		setChannel: setActive,
		thread: thread
			? (conversation.messages.find((message) => message.id === thread.id) ?? thread)
			: null,
		viewer,
	}
}
