'use client'

import { useEffect, useState } from 'react'

import { type ChannelView, type UseConversationResult, useChannels, useConversation } from './hooks'
import { useChatStore } from './provider'
import { useDelayedFlag } from './useDelayedFlag'
import type { WindowMessage } from './window'

/** A message to open a feed at: its id, to scroll to and mark, and its `createdAt`, to load around. */
export type FeedFocus = { at: string; id: string }

export type UseChatPanelArgs = {
	conversationKey: string
	/**
	 * The channel to open on instead of the first. When the viewer cannot read
	 * it, the panel opens on the first readable one and says so through
	 * `requestedChannelUnavailable`.
	 */
	initialChannel?: null | string
	/**
	 * A message id to open at: its channel (over `initialChannel`), the feed
	 * loaded around it, and for a reply its thread, scrolled to the reply. When
	 * it cannot be read, `requestedMessageUnavailable` says so.
	 */
	message?: null | string
}

export type UseChatPanelResult = {
	/** The readable channels, in instance order. */
	channels: ChannelView[]
	/** Close the thread. */
	closeThread: () => void
	/** The feed of the current channel. */
	conversation: UseConversationResult
	/** The channel shown: the one picked, else the one asked for, else the first. */
	current: ChannelView | undefined
	/** The message the feed opens at: the linked one, or a linked reply's root. */
	focus: FeedFocus | null
	/** Open a message's thread. */
	openThread: (message: WindowMessage) => void
	/** With exactly two channels, the other one: a "Switch to" shortcut instead of tabs. */
	other: ChannelView | undefined
	reads: boolean
	/** Show that channels are one moment away (a slow subscribe only). */
	loading: boolean
	/**
	 * `initialChannel` is not readable (access lost, or no such channel) and
	 * another one is shown. Cleared once the viewer picks a channel.
	 */
	requestedChannelUnavailable: boolean
	/** `message` cannot be read (deleted, access lost, another conversation). */
	requestedMessageUnavailable: boolean
	setChannel: (slug: string) => void
	/** The open thread's root, kept current as the feed updates; null when none is open. */
	thread: null | WindowMessage
	/** The reply the open thread opens at, when it was opened by a link to that reply. */
	threadFocus: FeedFocus | null
	viewer: null | string
}

type Target = {
	channel: string
	focus: FeedFocus
	/** For a reply: its root, and the reply to open the thread at. */
	reply: null | { focus: FeedFocus; root: WindowMessage }
}

type Located = { request: string } & (
	| { status: 'found'; target: Target }
	| { status: 'loading' }
	| { status: 'missing' }
)

/**
 * The state of one conversation's panel, for any markup: its channels and the
 * one shown, that channel's feed, and the open thread. It can open on a given
 * channel, or at a given message. The admin drawer and a website panel both
 * draw this.
 */
export const useChatPanel = ({
	conversationKey,
	initialChannel = null,
	message = null,
}: UseChatPanelArgs): UseChatPanelResult => {
	const store = useChatStore()
	const { channels, reads, status, viewer } = useChannels(conversationKey, { count: false })
	const [active, setActive] = useState<null | string>(null)
	const [thread, setThread] = useState<null | WindowMessage>(null)
	/** A linked reply's thread was closed: it opens like any other from then on. */
	const [linkedThreadDone, setLinkedThreadDone] = useState(false)
	const [located, setLocated] = useState<Located | null>(null)

	// Another conversation, channel or message asked for: start over, as on a fresh mount.
	const request = `${conversationKey}\n${initialChannel ?? ''}\n${message ?? ''}`
	const [shownFor, setShownFor] = useState(request)
	if (shownFor !== request) {
		setShownFor(request)
		setActive(null)
		setThread(null)
		setLinkedThreadDone(false)
	}

	useEffect(() => {
		if (!message) return
		let live = true
		store.api
			.get(message)
			.then((found) => {
				if (!live) return
				if (found.message.key !== conversationKey) {
					setLocated({ request, status: 'missing' })
					return
				}
				const own = { at: found.message.createdAt, id: String(found.message.id) }
				const root = found.message.parent ? (found.root ?? null) : null
				setLocated({
					request,
					status: 'found',
					target: {
						channel: found.message.channel,
						focus: root ? { at: root.createdAt, id: String(root.id) } : own,
						reply: root ? { focus: own, root } : null,
					},
				})
				if (root) setThread(root)
			})
			.catch(() => {
				if (live) setLocated({ request, status: 'missing' })
			})
		return () => {
			live = false
		}
	}, [conversationKey, message, request, store])

	const lookup: Located['status'] | null = message
		? located?.request === request
			? located.status
			: 'loading'
		: null
	const found = located?.request === request && located.status === 'found' ? located.target : null
	// Read only until the viewer picks a channel: their choice wins over the link.
	const target =
		active === null && found && channels.some((c) => c.slug === found.channel) ? found : null
	const asked = active ?? target?.channel ?? initialChannel
	const current =
		lookup === 'loading' && active === null
			? undefined
			: (channels.find((channel) => channel.slug === asked) ?? channels[0])
	const loading = useDelayedFlag(!current)
	const focus = target && current?.slug === target.channel ? target.focus : null
	const conversation = useConversation({
		anchor: focus?.at ?? null,
		channel: current?.slug,
		key: conversationKey,
	})
	const openRoot = thread
		? (conversation.messages.find((entry) => entry.id === thread.id) ?? thread)
		: null
	const threadFocus =
		target?.reply &&
		!linkedThreadDone &&
		thread &&
		String(thread.id) === String(target.reply.root.id)
			? target.reply.focus
			: null

	return {
		channels,
		closeThread: () => {
			setThread(null)
			if (target?.reply) setLinkedThreadDone(true)
		},
		conversation,
		current,
		focus,
		loading,
		openThread: setThread,
		other: channels.length === 2 ? channels.find((channel) => channel !== current) : undefined,
		reads,
		requestedChannelUnavailable:
			active === null &&
			status === 'ready' &&
			Boolean(initialChannel) &&
			lookup !== 'loading' &&
			!target &&
			!channels.some((channel) => channel.slug === initialChannel),
		requestedMessageUnavailable:
			active === null &&
			(lookup === 'missing' || (found !== null && status === 'ready' && !target)),
		setChannel: (slug) => {
			if (slug !== current?.slug) setActive(slug)
		},
		thread: openRoot,
		threadFocus,
		viewer,
	}
}
