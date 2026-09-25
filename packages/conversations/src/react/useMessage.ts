'use client'

import { useState } from 'react'

import { TEXT_TYPE } from '../shared/constants'
import { useMessageActions } from './hooks'
import type { WindowMessage } from './window'

export type UseMessageResult = {
	/** The viewer may delete it: their own, in a channel that takes writes. */
	canDelete: boolean
	/** The viewer may edit it: their own text message, in a channel that takes writes. */
	canEdit: boolean
	deleted: boolean
	/** The inline editor is open. */
	editing: boolean
	/** The thread has replies the viewer has not read. */
	hasNewReplies: boolean
	/** Written by the viewer. */
	own: boolean
	/** Delete it (soft; a root with replies stays as a placeholder). */
	remove: () => Promise<void>
	replies: number
	/** Save an edit and close the editor. */
	save: (body: unknown) => Promise<void>
	setEditing: (editing: boolean) => void
}

/**
 * The behaviour of one message, for any markup: whose it is, what the viewer
 * may do with it, the inline edit, and the thread summary's state.
 */
export const useMessage = ({
	message,
	readOnly = false,
	threadReadAt,
	viewer,
}: {
	message: WindowMessage
	/** The channel takes no writes here. */
	readOnly?: boolean
	/** When the viewer last read this message's thread. */
	threadReadAt?: string
	viewer: null | string
}): UseMessageResult => {
	const { edit, remove } = useMessageActions()
	const [editing, setEditing] = useState(false)
	const own = viewer !== null && message.authorKey === viewer
	const deleted = Boolean(message.deletedAt)
	const replies = message.replyCount ?? 0
	const hasNewReplies =
		replies > 0 &&
		Boolean(message.lastReplyAt) &&
		(!threadReadAt || new Date(message.lastReplyAt as string) > new Date(threadReadAt))
	const writable = own && !deleted && !readOnly
	return {
		canDelete: writable,
		canEdit: writable && message.type === TEXT_TYPE,
		deleted,
		editing,
		hasNewReplies,
		own,
		remove: async () => {
			await remove(message)
		},
		replies,
		save: async (body) => {
			await edit(message, { body })
			setEditing(false)
		},
		setEditing,
	}
}
