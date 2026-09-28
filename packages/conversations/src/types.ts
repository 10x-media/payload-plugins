import type { LexicalEditorProps } from '@payloadcms/richtext-lexical'
import type {
	CollectionConfig,
	CollectionSlug,
	Config,
	Endpoint,
	Field,
	PayloadComponent,
	PayloadRequest,
	Where,
} from 'payload'

import type { ResolvedGrant } from './server/access'
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
	/** Written by server code as a system author (`systemAuthors`), not by a person. */
	system?: boolean
}

export type AuthorsMap = Record<string, AuthorProjection>

export type ConversationsTarget = Omit<ParsedKey, 'key'> & { key: string }

/**
 * What one user gets on one target. `true`: every channel the target offers,
 * to read and write. A list: those channels. `{ read, create }`: read one set
 * and write another (`create` defaults to `read`; writing implies reading),
 * e.g. `{ read: true, create: [] }` for a conversation that became read-only.
 */
export type TargetGrant = true | string[] | { create?: true | string[]; read: true | string[] }

/**
 * Either the keys the user may see (every offered channel, read and write),
 * or a grant per key. A key left out, `false` or `null` is denied.
 */
export type ConversationsAccessResult =
	| string[]
	| Record<string, false | null | TargetGrant | undefined>

/**
 * Conversation access, batch by design: given the targets a request asks
 * about, answer for all of them at once. A list of 25 targets costs one
 * query, not 25. Everything that depends on the target (ownership, tenant,
 * a closed ticket) belongs here; channel rules see only the user. Required;
 * without it nothing is allowed.
 */
export type ConversationsAccess = (args: {
	req: PayloadRequest
	targets: ConversationsTarget[]
}) => ConversationsAccessResult | Promise<ConversationsAccessResult>

/**
 * A channel rule sees the user, not the target: it runs once per request
 * and channel however many conversations are asked about. Put anything
 * target-specific in conversation access instead.
 */
type ChannelArgs = { channel: string; req: PayloadRequest }
type MessageArgs = { message: ConversationMessage; req: PayloadRequest }

/** A channel's audience hint above the composer. */
export type ChannelCue = { label: LocalizedLabel; tone: 'neutral' | 'warning' }

export type ConversationsChannel = {
	access: {
		create: (args: ChannelArgs) => boolean | Promise<boolean>
		/** Default: the author only. */
		delete?: (args: MessageArgs) => boolean | Promise<boolean>
		read: (args: ChannelArgs) => boolean | Promise<boolean>
		/** Default: the author only. */
		update?: (args: MessageArgs) => boolean | Promise<boolean>
	}
	/**
	 * Shown above the composer: who reads what is written here, e.g. a warning
	 * for channels customers can read. A function answers per viewer (a customer
	 * needs no "visible to the customer"); null shows none.
	 */
	cue?: ChannelCue | ((args: { req: PayloadRequest }) => ChannelCue | null)
	label: LocalizedLabel
	slug: string
}

/** How a system author looks in the UI. */
export type SystemAuthor = { avatar?: null | string; name: LocalizedLabel }

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
	/**
	 * `message` (default): the type's `Component` stands in for the body, under
	 * the usual avatar, name and time. `bare`: the `Component` is the whole row,
	 * full width with no avatar or name line, never grouped with its
	 * neighbours; the menu and what hangs under a message (reactions, thread
	 * summary) stay. For system notes and one-line events ("Anna joined").
	 */
	layout?: 'bare' | 'message'
	slug: string
	validate?: (data: TData) => Promise<string | true> | string | true
}

/**
 * The server half of a realtime transport. `publish` is called after every
 * change a feed shows (message written, edited, deleted, touched), with the
 * message's channel when there is one. A transport may serve endpoints of its
 * own under `/api/conversations/<instance>` (a stream, an auth callback) and
 * name the client half the admin should use.
 */
/** What a browser needs to reach a Pusher-compatible service. Public: sent to clients. */
export type PusherClientOptions = {
	/** Pusher's cluster, e.g. `eu`; ignored with `wsHost`. */
	cluster?: string
	/** Default `true`. */
	forceTLS?: boolean
	/** The app key (not the secret). */
	key: string
	/** A Pusher-compatible server's socket host (Soketi, a gateway). */
	wsHost?: string
	wsPort?: number
}

/**
 * A client transport of your own for the admin: the import path of a factory
 * exported from a `'use client'` module (`'/transport/client#myTransport'`),
 * called in the browser with `options`. The plugin registers the path, so
 * `generate:importmap` finds it.
 */
export type CustomClientTransportSpec = { factory: string; options?: unknown }

/** The client half a server transport asks the admin to use. */
export type ClientTransportSpec =
	| 'polling'
	| 'sse'
	| { pusher: PusherClientOptions }
	| CustomClientTransportSpec

export type ConversationsServerTransport = {
	/** Which client transport the admin's provider uses. Default `polling`. */
	client?: ClientTransportSpec
	endpoints?: (args: { base: string; instance: ConversationsInstance }) => Endpoint[]
	publish: (args: {
		channel?: string
		instance: string
		key: string
		req: PayloadRequest
	}) => Promise<void> | void
}

/** One component, or several rendered in order. */
export type SlotComponents = PayloadComponent | PayloadComponent[]

export type ChatSlotConfig = {
	/** Rendered above the composer. */
	composerAbove?: SlotComponents
	/** Next to Send, before the host's `actions`: e.g. an attach button. Not while editing. */
	composerActions?: SlotComponents
	/** Inside the composer's box under the text: e.g. picked files. Not while editing. */
	composerBelow?: SlotComponents
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
	/**
	 * New mentions, after the message is saved. Each user matched
	 * `mentions.users` and passes the channel's `read` rule; with
	 * `mentions.verifyAccess` they also pass conversation access.
	 */
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

/**
 * Admin components that replace a built-in one entirely, as client component
 * paths. Each gets the props of the built-in it replaces and may render that
 * built-in itself to wrap the default (inside its own replacement, a built-in
 * draws the default).
 */
export type ChatComponentsConfig = {
	/** Instead of `ChatChannelTabs`. */
	ChannelTabs?: PayloadComponent
	/** Instead of `ChatComposer`: sending, replying and editing. */
	Composer?: PayloadComponent
	/** Instead of `ChatDrawer`; renders the Payload `Drawer` under `drawerSlug` itself. */
	Drawer?: PayloadComponent
	/** Instead of `ChatFeed`, in the panel and in threads. */
	Feed?: PayloadComponent
	/** Instead of `ChatMessage`, for every message, thread roots included. */
	Message?: PayloadComponent
	/** Instead of `ChatPanel`: tabs, feed, composer and the thread drawer. */
	Panel?: PayloadComponent
	/** Instead of `ChatThread`. */
	Thread?: PayloadComponent
	/** Instead of `ChatTrigger`, the button `comments()` adds. */
	Trigger?: PayloadComponent
}

export type ConversationsPluginOptions = {
	/** Conversation access. Required: nobody sees anything without it (fail closed). */
	access: ConversationsAccess
	channels: ConversationsChannel[]
	/** Admin components replacing built-in ones. For additions, use `slots`. */
	components?: ChatComponentsConfig
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
		/** Maximum bytes of a custom type's serialized `data`. Default 16 KiB. */
		dataBytes?: number
	}
	mentions?: {
		/** Mentions kept per message. Default 20. */
		max?: number
		/**
		 * Who can be mentioned, per users collection, as a `Where` built for the
		 * sender's request. This is where target-level visibility of mentionable
		 * people goes (same tenant, same team): candidates are the users it
		 * matches who pass the channel's `read` rule.
		 */
		users?: (args: {
			channel: string
			collection: string
			key: string
			req: PayloadRequest
		}) => Promise<Where> | Where
		/**
		 * Also run conversation access as each candidate, so a mention only ever
		 * reaches someone who can open the conversation. One access run per
		 * candidate; default off, `users` is the cheaper place for that rule.
		 */
		verifyAccess?: boolean
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
	/**
	 * Authors that are not people, for messages server code posts with
	 * `postMessage({ author: { system: 'import' } })`: stored as
	 * `system:import`, shown with this name and avatar. An unlisted name shows
	 * as "System". Never mentioned, never unread for themselves.
	 */
	systemAuthors?: Record<string, SystemAuthor>
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
	 * Deleted messages are a 404 too unless `deleted: true`. With `write: true`
	 * the viewer must also be able to post in its channel, else a 403: a
	 * read-only conversation (a closed ticket, an archived room) takes no
	 * changes. Costs nothing extra, the access check already answers it.
	 */
	readableMessage: (
		id: string,
		options?: { deleted?: boolean; write?: boolean }
	) => Promise<ConversationMessage>
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
	 * deleted. Runs in the built-in cascade (`deleteWithTarget: true`) before
	 * the messages go, so their fields can still be read; a custom cascade
	 * function takes this over.
	 */
	onTargetDelete?: (args: {
		instance: ConversationsInstance
		key: string
		req: PayloadRequest
	}) => Promise<void> | void
	/**
	 * After a message was deleted (soft delete, through the endpoints), e.g. to
	 * remove what the extension kept for it. Target deletion runs
	 * `onTargetDelete` instead.
	 */
	onMessageDelete?: (args: {
		instance: ConversationsInstance
		message: ConversationMessage
		req: PayloadRequest
	}) => Promise<void> | void
	/** Exposed to other extensions through the map. */
	options?: unknown
	/**
	 * Runs before every new message is created, a client send or `postMessage`,
	 * with this extension's part of the send (`ext[name]`, `undefined` when none
	 * came). Returns values for the extension's own `messageFields`, stored with
	 * the message; other keys are ignored. Refuse the send with `fail`. A send
	 * retried under the same `clientId` returns the stored message without
	 * running it again.
	 */
	send?: (args: {
		channel: string
		fail: (message: string, status: number) => never
		input: unknown
		instance: ConversationsInstance
		key: string
		parent: null | string
		req: PayloadRequest
		/** `client`: through the endpoints, as `req.user`. `server`: `postMessage`, trusted. */
		source: 'client' | 'server'
	}) => Promise<Record<string, unknown> | undefined> | Record<string, unknown> | undefined
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
	/** Conversation access for `keys`, as grants within each target's offered channels. */
	grants: (req: PayloadRequest, keys: string[]) => Promise<Map<string, ResolvedGrant>>
	channels: Map<string, ConversationsChannel>
	components: ChatComponentsConfig
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
	limits: { bodyBytes: number; bodyLength: number; dataBytes: number }
	mentions: {
		max: number
		users?: NonNullable<ConversationsPluginOptions['mentions']>['users']
		verifyAccess: boolean
	}
	/** Registered by the plugin, so typed as one of the host's collection slugs. */
	messagesSlug: CollectionSlug
	overrides: NonNullable<ConversationsPluginOptions['overrides']>
	readsSlug: CollectionSlug | null
	slots: ResolvedSlots
	slug: string
	systemAuthors: Record<string, SystemAuthor>
	targets: Required<{ [K in keyof ConversationsTargets]: Record<string, string[]> }>
	transport?: ConversationsServerTransport
	types: Map<string, MessageTypeDefinition>
	users: ResolvedUsersConfig[]
}
