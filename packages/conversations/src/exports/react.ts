'use client'

export {
	type ConversationsApi,
	ConversationsRequestError,
	createApi,
	type ListQuery,
	type SendBody,
} from '../react/api'
export {
	type ChannelView,
	resolveLabel,
	type SendInput,
	type UseChannelsResult,
	type UseConversationArgs,
	type UseConversationResult,
	useChannels,
	useConversation,
	useExtension,
	useExtensionApi,
	useMentionSearch,
	useMessageActions,
	useSend,
	useUnread,
} from '../react/hooks'
export { MessageBody, type MessageBodyProps } from '../react/MessageBody'
export { browserPollerEnv, type PollerEnv, type PollerIntervals } from '../react/poller'
export {
	ChatProvider,
	type ChatProviderProps,
	ChatScope,
	useChatStore,
	useOptionalChatStore,
} from '../react/provider'
export type { ConversationsStore, InstanceMeta } from '../react/store'
export {
	type ConversationsClientTransport,
	pollingTransport,
	type TransportConnection,
} from '../react/transport'
export { dividerBefore, type WindowMessage, type WindowState } from '../react/window'
export { formatCursor } from '../shared/cursor'
export { collectionKey, customKey, globalKey, parseKey, userKey } from '../shared/keys'
export type * from '../shared/wire'
