'use client'

import { useMemo } from 'react'

import type { AuthorsMap } from '../types'
import { type UseConversationResult, useConversation } from './hooks'
import type { WindowMessage } from './window'

/**
 * A thread's replies as their own window, with the authors of the root's feed
 * merged in so the root message and every reply resolve their names.
 */
export const useThread = ({
	anchor = null,
	authors,
	root,
}: {
	/** A moment (ISO) to open the replies around, e.g. a linked reply's `createdAt`. */
	anchor?: null | string
	/** The authors the root's feed already knows. */
	authors: AuthorsMap
	root: WindowMessage
}): UseConversationResult => {
	const conversation = useConversation({
		anchor,
		channel: root.channel,
		key: root.key,
		parent: String(root.id),
	})
	const merged = useMemo(
		() => ({ ...authors, ...conversation.authors }),
		[authors, conversation.authors]
	)
	return useMemo(() => ({ ...conversation, authors: merged }), [conversation, merged])
}
