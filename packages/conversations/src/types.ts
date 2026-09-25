import type { LexicalEditorProps } from '@payloadcms/richtext-lexical'
import type {
	CollectionConfig,
	CollectionSlug,
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
	/** Data extensions attach per message (`decorate`), by extension name. Never stored. */
	ext?: Record<string, unknown>
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

/** One component, or several rendered in order. */
export type SlotComponents = PayloadComponent | PayloadComponent[]

export type ChatSlotConfig = {
	/** Rendered above the composer. */
	composerAbove?: SlotComponents
	/** Rendered in the drawer header, after the title. */
	drawerHeader?: SlotComponents
	/** Items in each message's menu, after Reply in thread, Edit and Delete. */
	messageActions?: SlotComponents
	/** A row at the top of each message's menu, for one-click actions such as reactions. */
	messageQuickActions?: SlotComponents
	/** Rendered under each message body, deleted placeholders included (check `message.deletedAt`). */
	messageFooter?: SlotComponents
}

/** Slots after resolution: the host's components, then each extension's, in order. */
export type ResolvedSlots = { [K in keyof ChatSlotConfig]-?: PayloadComponent[] }

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
		/** Maximum bytes of a message's serialized Lexical body. Default 64 KiB. */
		bodyBytes?: number
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

/** Helpers an extension endpoint gets, bound to the request and instance. */
export type ExtensionContext = {
	/**
	 * Messages as the endpoints return them: decorated by every extension, with
	 * the `authors` projection. Hand the result back so windows merge it.
	 */
	respond: (messages: ConversationMessage[]) => Promise<{
		authors: AuthorsMap
		messages: Array<ConversationMessage & { removed?: boolean }>
	}>
	/** The request's JSON body, or `{}`. A malformed body is a 400. */
	body: () => Promise<Record<string, unknown>>
	/** A 4xx or 5xx with a message, as the core endpoints answer. */
	fail: (message: string, status: number) => never
	/**
	 * A message the viewer may read (conversation and channel access), or a 404.
	 * Deleted messages are a 404 too unless `deleted: true`.
	 */
	readableMessage: (id: string, options?: { deleted?: boolean }) => Promise<ConversationMessage>
	/** Move the message's `updatedAt` so every open window picks up the change. */
	touch: (id: number | string) => Promise<void>
	/** The signed-in user's key (`<collection>:<id>`), or a 401. */
	viewer: () => string
}

/** An endpoint an extension adds under `/api/conversations/<instance>/<extension>`. */
export type ExtensionEndpoint = {
	handler: (args: {
		ctx: ExtensionContext
		instance: ConversationsInstance
		req: PayloadRequest
	}) => Promise<Response> | Response
	method: 'delete' | 'get' | 'patch' | 'post' | 'put'
	/** Relative to the extension's base, e.g. `/toggle`. */
	path: string
}

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
	/**
	 * Public, serializable data for the browser, read with `useExtension(name)`:
	 * the extension's own client settings. Sent with every subscribe.
	 */
	client?: unknown
	/**
	 * Per-message data for a batch of messages, keyed by message id. The core
	 * calls it for every response that carries messages (pages, change sync,
	 * send, edit, delete, extension endpoints) and places each entry at
	 * `message.ext[name]`. One query for the batch, not one per message.
	 */
	decorate?: (args: {
		instance: ConversationsInstance
		messages: ConversationMessage[]
		req: PayloadRequest
		viewer: string
	}) => Promise<Record<string, unknown>> | Record<string, unknown>
	/** Endpoints under `/api/conversations/<instance>/<name>`, with access helpers. */
	endpoints?: ExtensionEndpoint[]
	/**
	 * Fields the extension stores on every message, added to the messages
	 * collection. They are the extension's own: the core never sends them to
	 * the browser, so `decorate` reads them and returns what clients see.
	 * Soft delete leaves them as they are.
	 */
	messageFields?: Field[]
	name: string
	/**
	 * Remove the extension's own rows for a conversation whose target was
	 * deleted. Runs in the built-in cascade (`deleteWithTarget: true`); a custom
	 * cascade function takes this over.
	 */
	onTargetDelete?: (args: {
		instance: ConversationsInstance
		key: string
		req: PayloadRequest
	}) => Promise<void> | void
	/** Exposed to other extensions through the map. */
	options?: unknown
	/** Components added to the instance slots, after the host's own. */
	slots?: ChatSlotConfig
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
	/** The extensions themselves, in order: their decorators, endpoints, cascades. */
	extensionList: ConversationsExtension[]
	hooks: ConversationsHooks
	limits: { bodyBytes: number; bodyLength: number }
	mentions: {
		max: number
		users?: NonNullable<ConversationsPluginOptions['mentions']>['users']
	}
	/** Registered by the plugin, so typed as one of the host's collection slugs. */
	messagesSlug: CollectionSlug
	overrides: NonNullable<ConversationsPluginOptions['overrides']>
	readsSlug: CollectionSlug | null
	slots: ResolvedSlots
	slug: string
	targets: Required<{ [K in keyof ConversationsTargets]: Record<string, string[]> }>
	transport?: ConversationsServerTransport
	types: Map<string, MessageTypeDefinition>
	users: ResolvedUsersConfig[]
}
