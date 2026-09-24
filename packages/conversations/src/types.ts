import type { LexicalEditorProps } from '@payloadcms/richtext-lexical'
import type {
	CollectionConfig,
	Config,
	Field,
	PayloadComponent,
	PayloadRequest,
	Where,
} from 'payload'

import type { ParsedKey, UserRef } from './shared/keys'
import type { TranslationsOption } from './translations'

export type { ParsedKey, TargetKind, UserRef } from './shared/keys'

/** One feature of an instance editor, as `lexicalEditor({ features })` takes it. */
export type ConversationsEditorFeature = Extract<
	NonNullable<LexicalEditorProps['features']>,
	readonly unknown[]
>[number]

/** A string, or one string per locale. */
export type LocalizedLabel = Record<string, string> | string

/** A stored message, as the endpoints return it. */
export type ConversationMessage = {
	authorKey: string
	body?: unknown
	channel: string
	clientId?: null | string
	createdAt: string
	data?: unknown
	deletedAt?: null | string
	editedAt?: null | string
	id: number | string
	key: string
	lastReplyAt?: null | string
	mentions?: null | string[]
	parent?: null | string
	replyCount?: null | number
	text?: null | string
	type: string
	updatedAt: string
}

/** What a user looks like in the UI, projected on the server per response. */
export type AuthorProjection = {
	avatar?: null | string
	deleted?: boolean
	name: string
}

export type AuthorsMap = Record<string, AuthorProjection>

export type ConversationsTarget = Omit<ParsedKey, 'key'> & { key: string }

/**
 * Conversation access, batch by design: given the targets a request asks
 * about, return the keys the user may see. A list of 25 targets costs one
 * query, not 25. Required; without it nothing is allowed.
 */
export type ConversationsAccess = (args: {
	req: PayloadRequest
	targets: ConversationsTarget[]
}) => Promise<string[]> | string[]

type ChannelArgs = { key: string; req: PayloadRequest; target: ParsedKey }
type MessageArgs = { message: ConversationMessage; req: PayloadRequest }

export type ConversationsChannel = {
	access: {
		create: (args: ChannelArgs) => boolean | Promise<boolean>
		/** Default: the author only. */
		delete?: (args: MessageArgs) => boolean | Promise<boolean>
		read: (args: ChannelArgs) => boolean | Promise<boolean>
		/** Default: the author only. */
		update?: (args: MessageArgs) => boolean | Promise<boolean>
	}
	/** Shown above the composer, e.g. a warning for channels external users can read. */
	cue?: { label: LocalizedLabel; tone: 'neutral' | 'warning' }
	label: LocalizedLabel
	slug: string
}

export type ConversationsUsersConfig = {
	collection: string
	/** Projection for display. Default: the collection's `useAsTitle`, no avatar. */
	display?: (doc: Record<string, unknown>) => { avatar?: null | string; name: string }
}

export type TargetChannels = { channels: string[] }

export type ConversationsTargets = {
	collections?: Record<string, TargetChannels>
	/** Keyed by the custom prefix: `custom:<prefix>:...` or `custom:<prefix>`. */
	custom?: Record<string, TargetChannels>
	globals?: Record<string, TargetChannels>
}

/** A custom message type. `TData` types its `data`. */
export type MessageTypeDefinition<TData = unknown> = {
	/** Accepted from clients only when true, and only after `validate` passes. */
	clientCreatable?: boolean
	/** A PayloadComponent path; client or server component. */
	Component?: PayloadComponent
	slug: string
	validate?: (data: TData) => Promise<string | true> | string | true
}

export type ConversationsServerTransport = {
	publish: (args: { instance: string; key: string; req: PayloadRequest }) => Promise<void> | void
}

export type ChatSlotConfig = {
	/** Rendered above the composer. */
	composerAbove?: PayloadComponent
	/** Rendered in the drawer header, after the title. */
	drawerHeader?: PayloadComponent
	/** Rendered in each message's action row. */
	messageActions?: PayloadComponent
	/** Rendered under each message body. */
	messageFooter?: PayloadComponent
}

export type CollectionOverride = {
	access?: CollectionConfig['access']
	admin?: CollectionConfig['admin']
	/** Composition seam: receives the built fields, returns the result. */
	fields?: (args: { defaultFields: Field[] }) => Field[]
	hooks?: CollectionConfig['hooks']
}

export type DeleteWithTarget =
	| boolean
	| ((args: { instance: string; key: string; req: PayloadRequest }) => Promise<void> | void)

export type ConversationsHooks = {
	afterMention?: (args: {
		channel: string
		key: string
		message: ConversationMessage
		req: PayloadRequest
		users: UserRef[]
	}) => Promise<void> | void
	afterMessage?: (args: {
		message: ConversationMessage
		operation: 'create' | 'delete' | 'update'
		req: PayloadRequest
	}) => Promise<void> | void
}

export type ConversationsPluginOptions = {
	/** Conversation access. Required: nobody sees anything without it (fail closed). */
	access: ConversationsAccess
	channels: ConversationsChannel[]
	/** Cascade on target delete. Default true; a function replaces the built-in cascade. */
	deleteWithTarget?: DeleteWithTarget
	/** Default `'placeholderIfReplies'`. */
	deleted?: 'placeholder' | 'placeholderIfReplies'
	disabled?: boolean
	/** Extend or reshape the instance editor's features. */
	editor?: (args: { defaultFeatures: ConversationsEditorFeature[] }) => ConversationsEditorFeature[]
	extensions?: ConversationsExtension[]
	hooks?: ConversationsHooks
	limits?: {
		/** Maximum characters of a message's plain text. Default 10 000. */
		bodyLength?: number
	}
	mentions?: {
		/** Mentions kept per message. Default 20. */
		max?: number
		/** Who can be mentioned, per users collection. */
		users?: (args: {
			channel: string
			collection: string
			key: string
			req: PayloadRequest
		}) => Promise<Where> | Where
	}
	overrides?: {
		messages?: CollectionOverride
		reads?: CollectionOverride
	}
	/** Per-user read cursors. Default true. */
	reads?: boolean
	slots?: ChatSlotConfig
	/** Names the instance: `<slug>-messages`, `/api/conversations/<slug>`. */
	slug: string
	targets?: ConversationsTargets
	translations?: TranslationsOption
	transport?: ConversationsServerTransport
	// biome-ignore lint/suspicious/noExplicitAny: each type carries its own data shape
	types?: MessageTypeDefinition<any>[]
	/** Auth collections whose users take part. Default: `[config.admin.user]`. */
	users?: Array<ConversationsUsersConfig | string>
}

/** What an extension sees of the others, by name. */
export type ExtensionMap = ReadonlyMap<string, { options?: unknown }>

export type ConversationsExtension = {
	/** Runs after the instance is resolved, in array order. May return a new config. */
	after?: (args: {
		config: Config
		extensions: ExtensionMap
		instance: ConversationsInstance
	}) => Config
	/** Runs before the instance is resolved, in array order. */
	before?: (
		options: ConversationsPluginOptions,
		ctx: { extensions: ExtensionMap }
	) => ConversationsPluginOptions
	name: string
	/** Exposed to other extensions through the map, and on the client. */
	options?: unknown
}

export type ResolvedUsersConfig = {
	collection: string
	display: (doc: Record<string, unknown>) => { avatar?: null | string; name: string }
	/** The field the mention search matches against: `useAsTitle`, else `email`. */
	searchField: string
}

/** A resolved instance: what endpoints, hooks and extensions work against. */
export type ConversationsInstance = {
	access: ConversationsAccess
	/** Keys among `keys` the request may see (conversation access only). */
	allowedKeys: (req: PayloadRequest, keys: string[]) => Promise<Set<string>>
	channels: Map<string, ConversationsChannel>
	/** Channels a target offers, in instance order; empty when the target is not served. */
	channelsFor: (target: ParsedKey) => string[]
	deleted: 'placeholder' | 'placeholderIfReplies'
	deleteWithTarget: DeleteWithTarget
	editorFeatures: (args: {
		defaultFeatures: ConversationsEditorFeature[]
	}) => ConversationsEditorFeature[]
	extensions: ExtensionMap
	hooks: ConversationsHooks
	limits: { bodyLength: number }
	mentions: {
		max: number
		users?: NonNullable<ConversationsPluginOptions['mentions']>['users']
	}
	messagesSlug: string
	overrides: NonNullable<ConversationsPluginOptions['overrides']>
	readsSlug: null | string
	slots: ChatSlotConfig
	slug: string
	targets: Required<{ [K in keyof ConversationsTargets]: Record<string, string[]> }>
	transport?: ConversationsServerTransport
	types: Map<string, MessageTypeDefinition>
	users: ResolvedUsersConfig[]
}
