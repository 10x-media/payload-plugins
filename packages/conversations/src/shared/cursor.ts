import type { ConversationMessage } from '../types'

/** A keyset position as the endpoints take it: `<createdAt>,<id>`. */
export const formatCursor = (message: Pick<ConversationMessage, 'createdAt' | 'id'>): string =>
	`${new Date(message.createdAt).toISOString()},${String(message.id)}`
