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
	authors,
	root,
}: {
	/** The authors the root's feed already knows. */
	authors: AuthorsMap
	root: WindowMessage
}): UseConversationResult => {
	const conversation = useConversation({
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
