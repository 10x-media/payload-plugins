import { APIError, type CollectionSlug, type PayloadRequest, type Where } from 'payload'

import { isRemoved } from '../collections/messages'
import { AUTHOR_CONTEXT, TEXT_TYPE } from '../shared/constants'
import {
	userKey as formatUserKey,
	type ParsedKey,
	parseKey,
	parseUserKey,
	systemKey,
} from '../shared/keys'
import type {
	ChannelAccess,
	ListResponse,
	MentionCandidate,
	SubscribeResponse,
	WireMessage,
} from '../shared/wire'
import type {
	AuthorsMap,
	ConversationMessage,
	ConversationsInstance,
	ExtensionContext,
} from '../types'
import { channelAllows } from './access'
import { readersAmong } from './audience'
import { projectAuthors } from './authors'
import { isLexicalBody, textToBody } from './body'
import { changedKeys, type FeedWindow, loadFeed, MAX_LIMIT, messageCounts } from './feed'
import { conversationCursors, raiseCursor, threadCursors, unreadCounts } from './reads'
import { signToken, TOKEN_TTL_MS, verifyToken } from './tokens'

const fail = (message: string, status: number): never => {
	throw new APIError(message, status, undefined, true)
}

/** The signed-in user's key, or a 401. */
export const viewerKey = (req: PayloadRequest): string => {
	if (!req.user) {
		return fail('Unauthorized', 401)
	}
	return formatUserKey(req.user.collection, req.user.id)
}

export type KeyAccess = { channels: ChannelAccess[]; key: string; target: ParsedKey }

/**
 * Effective access for many keys: conversation access once for the batch
 * (which channels of each target, to read and to write), intersected with
 * the channel rules, which run once per request and channel. Keys the user
 * may not see, or with no readable channel, are left out.
 */
export const resolveAccess = async (
	req: PayloadRequest,
	instance: ConversationsInstance,
	keys: string[]
): Promise<Map<string, KeyAccess>> => {
	const grants = await instance.grants(req, keys)
	const out = new Map<string, KeyAccess>()
	await Promise.all(
		[...grants].map(async ([key, grant]) => {
			const target = parseKey(key)
			if (!target) {
				return
			}
			const channels: ChannelAccess[] = []
			for (const slug of instance.channelsFor(target)) {
				if (
					!grant.read.has(slug) ||
					!(await channelAllows(req, instance, { action: 'read', channel: slug }))
				) {
					continue
				}
				const canCreate =
					grant.create.has(slug) &&
					(await channelAllows(req, instance, { action: 'create', channel: slug }))
				channels.push({ canCreate, slug })
			}
			if (channels.length > 0) {
				out.set(key, { channels, key, target })
			}
		})
	)
	return out
}

const accessFor = async (
	req: PayloadRequest,
	instance: ConversationsInstance,
	key: string
): Promise<KeyAccess> => {
	const access = (await resolveAccess(req, instance, [key])).get(key)
	return access ?? fail('Not found', 404)
}

/**
 * Batch access for mounted conversations: channels, unread counts, poll
 * tokens, and message counts for the keys in `count` (all by default; a list
 * surface that shows no totals passes none and saves a query per key).
 */
export const subscribe = async (
	req: PayloadRequest,
	instance: ConversationsInstance,
	{ count = true, keys }: { count?: boolean | string[]; keys: string[] }
): Promise<SubscribeResponse> => {
	const viewer = viewerKey(req)
	const access = await resolveAccess(req, instance, keys.slice(0, 200))
	const list = [...access.values()]
	const counts = instance.readsSlug
		? await unreadCounts(req, instance, {
				cursors: await conversationCursors(req, instance, {
					keys: list.map((entry) => entry.key),
					userKey: viewer,
				}),
				entries: list.map((entry) => ({
					channels: entry.channels.map((c) => c.slug),
					key: entry.key,
				})),
				userKey: viewer,
			})
		: undefined
	const counted = count === true ? null : new Set(count === false ? [] : count)
	const totals = await messageCounts(
		req,
		instance,
		list
			.filter((entry) => !counted || counted.has(entry.key))
			.map((entry) => ({ channels: entry.channels.map((c) => c.slug), key: entry.key }))
	)
	const exp = Date.now() + TOKEN_TTL_MS
	return {
		entries: list.map((entry) => ({
			channels: entry.channels,
			...(entry.key in totals ? { count: totals[entry.key] } : {}),
			key: entry.key,
			token: signToken(req.payload.secret, {
				channels: entry.channels.map((c) => c.slug),
				exp,
				instance: instance.slug,
				key: entry.key,
				userKey: viewer,
			}),
			...(counts ? { unread: counts[entry.key] } : {}),
		})),
		channels: Object.fromEntries(
			[...instance.channels.values()].map((channel) => {
				// Per viewer: a function cue answers for this request.
				const cue = typeof channel.cue === 'function' ? channel.cue({ req }) : channel.cue
				return [channel.slug, { label: channel.label, ...(cue ? { cue } : {}) }]
			})
		),
		deleted: instance.deleted,
		extensionData: Object.fromEntries(
			instance.extensionList
				.filter((extension) => extension.client !== undefined)
				.map((extension) => [extension.name, extension.client])
		),
		extensions: [...instance.extensions.keys()],
		now: new Date().toISOString(),
		reads: instance.readsSlug !== null,
		types: Object.fromEntries(
			[...instance.types.values()].map((type) => [type.slug, { layout: type.layout ?? 'message' }])
		),
		viewer,
	}
}

export type ListParams = {
	channels: string[]
	key: string
	limit: number
	parent?: null | string
	/** Omitted: open at the latest page, or around the first unread when there are many. */
	window?: FeedWindow
}

/** A page of a feed or a thread, with the author projection and read state. */
export const listMessages = async (
	req: PayloadRequest,
	instance: ConversationsInstance,
	params: ListParams
): Promise<ListResponse> => {
	const viewer = viewerKey(req)
	// Clamped once here, so the unread check below compares against the page size served.
	const limit = Math.max(1, Math.min(params.limit, MAX_LIMIT))
	const access = await accessFor(req, instance, params.key)
	const readable = new Set(access.channels.map((channel) => channel.slug))
	const channels = params.channels.filter((channel) => readable.has(channel))
	if (channels.length === 0) {
		fail('Not found', 404)
	}
	let cursor: null | string | undefined
	let window = params.window
	if (!window) {
		cursor = null
		if (instance.readsSlug) {
			if (params.parent) {
				cursor =
					(
						await threadCursors(req, instance, {
							key: params.key,
							rootIds: [params.parent],
							userKey: viewer,
						})
					)[params.parent] ?? null
			} else {
				// Several channels in one feed open at the earliest of their cursors.
				const byChannel =
					(await conversationCursors(req, instance, { keys: [params.key], userKey: viewer })).get(
						params.key
					) ?? {}
				const each = channels.map((channel) => byChannel[channel])
				cursor = each.every(Boolean) ? ([...(each as string[])].sort()[0] ?? null) : null
			}
		}
		window = { mode: 'latest' }
		if (cursor) {
			const unread = await req.payload.db.count({
				collection: instance.messagesSlug,
				where: {
					and: [
						{ key: { equals: params.key } },
						{ channel: { in: channels } },
						{ parent: { equals: params.parent ?? null } },
						{ createdAt: { greater_than: cursor } },
					],
				},
			})
			if (unread.totalDocs > limit) {
				window = { around: cursor, mode: 'around' }
			}
		}
	}
	const feed = await loadFeed(req, instance, {
		channels,
		key: params.key,
		limit,
		parent: params.parent,
		window,
	})
	const roots = params.parent
		? []
		: feed.messages.filter((m) => (m.replyCount ?? 0) > 0).map((m) => String(m.id))
	const [authors, threadReads] = await Promise.all([
		projectAuthors(req, instance, feed.messages),
		threadCursors(req, instance, { key: params.key, rootIds: roots, userKey: viewer }),
	])
	return {
		authors,
		...(cursor !== undefined ? { cursor } : {}),
		hasNewer: feed.hasNewer,
		hasOlder: feed.hasOlder,
		messages: await decorateMessages(req, instance, { messages: feed.messages, viewer }),
		threadReads,
	}
}

export type SendInput = {
	body?: unknown
	channel?: string
	clientId?: string
	data?: unknown
	/** Per extension, by name: what its `send` hook reads. */
	ext?: unknown
	key: string
	parent?: null | string
	text?: string
	type?: string
}

const findRoot = async (
	req: PayloadRequest,
	instance: ConversationsInstance,
	id: string
): Promise<ConversationMessage | null> =>
	(await req.payload.db.findOne({
		collection: instance.messagesSlug,
		where: { id: { equals: id } },
	})) as ConversationMessage | null

/** Create a message as the signed-in user, after conversation and channel access. */
export const sendMessage = async (
	req: PayloadRequest,
	instance: ConversationsInstance,
	input: SendInput
): Promise<{ authors: AuthorsMap; message: ConversationMessage; root?: WireMessage }> => {
	const viewer = viewerKey(req)
	const access = await accessFor(req, instance, input.key)
	let channel = input.channel
	if (input.parent) {
		const root = await findRoot(req, instance, String(input.parent))
		if (!root || root.key !== input.key) {
			return fail('Not found', 404)
		}
		channel = root.channel
	}
	if (!access.channels.some((entry) => entry.slug === channel && entry.canCreate)) {
		return fail('Forbidden', 403)
	}
	const type = input.type ?? TEXT_TYPE
	if (type !== TEXT_TYPE && instance.types.get(type)?.clientCreatable !== true) {
		return fail(`Message type "${type}" cannot be sent by clients`, 400)
	}
	if (typeof input.clientId === 'string' && input.clientId) {
		const existing = (await req.payload.db.findOne({
			collection: instance.messagesSlug,
			where: {
				and: [{ clientId: { equals: input.clientId } }, { authorKey: { equals: viewer } }],
			},
		})) as ConversationMessage | null
		if (existing) {
			return {
				authors: await projectAuthors(req, instance, [existing]),
				message: await decorateOne(req, instance, { message: existing, viewer }),
			}
		}
	}
	const body = type === TEXT_TYPE ? toBody(input) : undefined
	const fields = await extensionFields(req, instance, {
		channel: channel ?? '',
		ext: input.ext,
		key: input.key,
		parent: input.parent ?? null,
		source: 'client',
	})
	const message = await createMessage(req, instance, {
		...fields,
		body,
		channel,
		clientId: input.clientId,
		data: type === TEXT_TYPE ? undefined : input.data,
		key: input.key,
		parent: input.parent ?? null,
		type,
	})
	await raiseCursor(req, instance, {
		at: message.createdAt,
		channel: message.channel,
		key: message.key,
		thread: message.parent ?? '',
		userKey: message.authorKey,
	})
	const root = await rootAfterReply(req, instance, { message, viewer })
	return {
		authors: await projectAuthors(req, instance, [message]),
		message: await decorateOne(req, instance, { message, viewer }),
		...(root ? { root } : {}),
	}
}

/**
 * A reply's root as it is after the reply was written or removed: its count
 * and last reply moved, so the sender's feed can show that at once instead of
 * waiting for the next poll.
 */
const rootAfterReply = async (
	req: PayloadRequest,
	instance: ConversationsInstance,
	{ message, viewer }: { message: ConversationMessage; viewer: string }
): Promise<WireMessage | undefined> => {
	if (!message.parent) return undefined
	const root = await findRoot(req, instance, message.parent)
	if (!root) return undefined
	const decorated = await decorateOne(req, instance, { message: root, viewer })
	return isRemoved(instance, root) ? { ...decorated, removed: true } : decorated
}

/**
 * The extensions' `send` hooks for a new message: each reads its part of
 * `ext` and returns values for its own `messageFields`, nothing else.
 */
const extensionFields = async (
	req: PayloadRequest,
	instance: ConversationsInstance,
	args: {
		channel: string
		ext: unknown
		key: string
		parent: null | string
		source: 'client' | 'server'
	}
): Promise<Record<string, unknown>> => {
	if (args.ext !== undefined && args.ext !== null && !isRecord(args.ext)) {
		return fail('Invalid ext', 400)
	}
	const ext = (args.ext ?? {}) as Record<string, unknown>
	const fields: Record<string, unknown> = {}
	for (const extension of instance.extensionList) {
		if (!extension.send) continue
		const values = await extension.send({
			channel: args.channel,
			fail,
			input: ext[extension.name],
			instance,
			key: args.key,
			parent: args.parent,
			req,
			source: args.source,
		})
		if (!values) continue
		for (const field of extension.messageFields ?? []) {
			if ('name' in field && field.name in values) fields[field.name] = values[field.name]
		}
	}
	return fields
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === 'object' && value !== null && !Array.isArray(value)

const toBody = (input: { body?: unknown; text?: string }) => {
	if (input.body !== undefined && input.body !== null) {
		return isLexicalBody(input.body) ? input.body : fail('Invalid body', 400)
	}
	if (typeof input.text === 'string') {
		return textToBody(input.text)
	}
	return fail('A message needs a body or text', 400)
}

/**
 * Every write the plugin makes runs without a transaction. A message is one
 * row plus an atomic counter on its root; wrapping that in a transaction buys
 * nothing and costs twice: concurrent replies abort each other on Mongo
 * (WriteConflict on the root), and on Postgres each one would hold a pooled
 * connection while hooks ask for another.
 */
const writeOptions = { depth: 0, disableTransaction: true, overrideAccess: true } as const

const createMessage = async (
	req: PayloadRequest,
	instance: ConversationsInstance,
	data: Record<string, unknown>
): Promise<ConversationMessage> =>
	(await req.payload.create({
		...writeOptions,
		collection: instance.messagesSlug,
		data,
		req,
	})) as unknown as ConversationMessage

const loadOwned = async (
	req: PayloadRequest,
	instance: ConversationsInstance,
	{ action, id }: { action: 'delete' | 'update'; id: string }
): Promise<ConversationMessage> => {
	const message = await findRoot(req, instance, id)
	if (!message || message.deletedAt) {
		return fail('Not found', 404)
	}
	const access = await accessFor(req, instance, message.key)
	const channel = access.channels.find((entry) => entry.slug === message.channel)
	if (!channel) {
		return fail('Not found', 404)
	}
	// A read-only conversation takes no edits or deletes either.
	if (!channel.canCreate) {
		return fail('Forbidden', 403)
	}
	const rule = instance.channels.get(message.channel)?.access[action]
	const allowed = rule ? await rule({ message, req }) : message.authorKey === viewerKey(req)
	return allowed ? message : fail('Forbidden', 403)
}

/** Edit a text message's body. `afterMention` then sees only newly added mentions. */
export const editMessage = async (
	req: PayloadRequest,
	instance: ConversationsInstance,
	input: { body?: unknown; id: string; text?: string }
): Promise<{ authors: AuthorsMap; message: ConversationMessage }> => {
	const existing = await loadOwned(req, instance, { action: 'update', id: input.id })
	if (existing.type !== TEXT_TYPE) {
		return fail('Only text messages can be edited', 400)
	}
	// Typed loosely: the body's shape is the host editor's, not the generated type's.
	const data: Record<string, unknown> = { body: toBody(input), editedAt: new Date().toISOString() }
	const message = (await req.payload.update({
		collection: instance.messagesSlug,
		...writeOptions,
		data,
		id: existing.id,
		req,
	})) as unknown as ConversationMessage
	return {
		authors: await projectAuthors(req, instance, [message]),
		message: await decorateOne(req, instance, { message, viewer: viewerKey(req) }),
	}
}

/** Soft-delete: content is wiped on the server, the row stays for counters and placeholders. */
export const deleteMessage = async (
	req: PayloadRequest,
	instance: ConversationsInstance,
	id: string
): Promise<{ message: WireMessage; root?: WireMessage }> => {
	const existing = await loadOwned(req, instance, { action: 'delete', id })
	const message = (await req.payload.update({
		collection: instance.messagesSlug,
		...writeOptions,
		data: { deletedAt: new Date().toISOString() },
		id: existing.id,
		req,
	})) as unknown as ConversationMessage
	for (const extension of instance.extensionList) {
		await extension.onMessageDelete?.({ instance, message, req })
	}
	const viewer = viewerKey(req)
	const decorated = await decorateOne(req, instance, { message, viewer })
	const root = await rootAfterReply(req, instance, { message, viewer })
	return {
		message: isRemoved(instance, message) ? { ...decorated, removed: true } : decorated,
		...(root ? { root } : {}),
	}
}

/** Raise the viewer's cursor for channels of a conversation, or for one thread of it. */
export const markRead = async (
	req: PayloadRequest,
	instance: ConversationsInstance,
	input: { at?: unknown; channels?: unknown; key: string; thread?: unknown }
): Promise<void> => {
	const viewer = viewerKey(req)
	if (!instance.readsSlug) {
		return
	}
	const access = await accessFor(req, instance, input.key)
	const at = new Date(typeof input.at === 'string' ? input.at : Date.now())
	if (Number.isNaN(at.getTime())) {
		fail('Invalid time', 400)
	}
	const now = Date.now()
	const capped = at.getTime() > now ? new Date(now) : at
	if (typeof input.thread === 'string' && input.thread) {
		await raiseCursor(req, instance, {
			at: capped,
			key: input.key,
			thread: input.thread,
			userKey: viewer,
		})
		return
	}
	const readable = new Set(access.channels.map((channel) => channel.slug))
	const channels = (Array.isArray(input.channels) ? input.channels : []).filter(
		(channel): channel is string => typeof channel === 'string' && readable.has(channel)
	)
	if (channels.length === 0) {
		fail('channels is required', 400)
	}
	await Promise.all(
		channels.map((channel) =>
			raiseCursor(req, instance, { at: capped, channel, key: input.key, userKey: viewer })
		)
	)
}

/** How far back a poll looks past `since`: covers late commits and clock skew. */
export const POLL_OVERLAP_MS = 10_000

/**
 * The poll: verify tokens without touching access code, then one change query.
 * Tokens are bound to the user who got them.
 */
export const poll = async (
	req: PayloadRequest,
	instance: ConversationsInstance,
	input: { since?: unknown; tokens?: unknown }
): Promise<{ changed: string[]; expired: string[]; now: string }> => {
	const viewer = viewerKey(req)
	const now = new Date()
	const tokens = Array.isArray(input.tokens) ? input.tokens.slice(0, 200) : []
	const entries: Array<{ channels: string[]; key: string }> = []
	const expired: string[] = []
	for (const token of tokens) {
		const claims = verifyToken(req.payload.secret, token)
		if (!claims || claims.instance !== instance.slug || claims.userKey !== viewer) {
			if (typeof token === 'string') {
				expired.push(token)
			}
			continue
		}
		entries.push({ channels: claims.channels, key: claims.key })
	}
	const since = new Date(typeof input.since === 'string' ? input.since : now.toISOString())
	if (Number.isNaN(since.getTime())) {
		fail('Invalid since', 400)
	}
	const changed = await changedKeys(req, instance, {
		entries,
		since: new Date(since.getTime() - POLL_OVERLAP_MS).toISOString(),
	})
	return { changed, expired, now: now.toISOString() }
}

/** Mention candidates across the users collections: `mentions.users`, then the channel rule. */
export const searchMentions = async (
	req: PayloadRequest,
	instance: ConversationsInstance,
	input: { channel: string; key: string; q: string }
): Promise<MentionCandidate[]> => {
	const access = await accessFor(req, instance, input.key)
	if (!access.channels.some((entry) => entry.slug === input.channel)) {
		return fail('Not found', 404)
	}
	const q = input.q.trim().slice(0, 100)
	const perCollection = 8
	const found = await Promise.all(
		instance.users.map(async (users) => {
			const scope = instance.mentions.users
				? await instance.mentions.users({
						channel: input.channel,
						collection: users.collection,
						key: input.key,
						req,
					})
				: undefined
			const where: Where[] = []
			if (scope) {
				where.push(scope)
			}
			if (q) {
				where.push({ [users.searchField]: { like: q } })
			}
			const result = await req.payload.find({
				collection: users.collection as CollectionSlug,
				depth: 0,
				limit: perCollection,
				overrideAccess: true,
				pagination: false,
				req,
				where: where.length > 0 ? { and: where } : {},
			})
			return (result.docs as unknown as Array<Record<string, unknown>>).map((doc) => ({
				doc,
				userKey: formatUserKey(users.collection, doc.id as string),
				users,
			}))
		})
	)
	const flat = found.flat()
	// Already narrowed by `mentions.users` above, so only the channel rule is left.
	const readers = new Set(
		await readersAmong(req, instance, {
			candidates: flat.map((entry) => [
				entry.userKey,
				{ ...entry.doc, collection: entry.users.collection },
			]),
			channel: input.channel,
			key: input.key,
		})
	)
	return flat
		.filter((entry) => readers.has(entry.userKey))
		.map((entry) => {
			const projected = entry.users.display(entry.doc)
			return { avatar: projected.avatar ?? null, name: projected.name, userKey: entry.userKey }
		})
}

/**
 * Every extension's per-message data (`decorate`), placed at `message.ext[name]`.
 * One call per extension for the whole batch.
 */
export const decorateMessages = async <T extends ConversationMessage>(
	req: PayloadRequest,
	instance: ConversationsInstance,
	{ messages, viewer }: { messages: T[]; viewer: string }
): Promise<T[]> => {
	const decorators = instance.extensionList.filter((extension) => extension.decorate)
	const own = privateFields(instance)
	if (decorators.length === 0 || messages.length === 0) {
		return own.length > 0 ? messages.map((message) => withoutFields(message, own)) : messages
	}
	const results = await Promise.all(
		decorators.map(
			async (extension) =>
				[
					extension.name,
					(await extension.decorate?.({ instance, messages, req, viewer })) ?? {},
				] as const
		)
	)
	return messages.map((message) => {
		const ext: Record<string, unknown> = { ...message.ext }
		let changed = false
		for (const [name, data] of results) {
			const value = data[String(message.id)]
			if (value !== undefined) {
				ext[name] = value
				changed = true
			}
		}
		const visible = own.length > 0 ? withoutFields(message, own) : message
		return changed ? { ...visible, ext } : visible
	})
}

/** Names of the extensions' `messageFields`, which stay on the server. */
const privateFields = (instance: ConversationsInstance): string[] =>
	instance.extensionList.flatMap((extension) =>
		(extension.messageFields ?? []).flatMap((field) => ('name' in field ? [field.name] : []))
	)

const withoutFields = <T extends ConversationMessage>(message: T, names: string[]): T => {
	const copy = { ...message } as Record<string, unknown>
	for (const name of names) delete copy[name]
	return copy as T
}

const decorateOne = async <T extends ConversationMessage>(
	req: PayloadRequest,
	instance: ConversationsInstance,
	{ message, viewer }: { message: T; viewer: string }
): Promise<T> =>
	(await decorateMessages(req, instance, { messages: [message], viewer }))[0] ?? message

/** The helpers an extension endpoint gets, bound to one request. */
export const extensionContext = (
	req: PayloadRequest,
	instance: ConversationsInstance
): ExtensionContext => ({
	body: async () => {
		try {
			const body = (await req.json?.()) as unknown
			return typeof body === 'object' && body !== null ? (body as Record<string, unknown>) : {}
		} catch {
			return fail('Invalid JSON body', 400)
		}
	},
	fail,
	readableMessage: async (id, options = {}) => {
		const message = await findRoot(req, instance, id)
		if (!message || (message.deletedAt && !options.deleted)) {
			return fail('Not found', 404)
		}
		const access = await accessFor(req, instance, message.key)
		const channel = access.channels.find((entry) => entry.slug === message.channel)
		if (!channel) {
			return fail('Not found', 404)
		}
		if (options.write && !channel.canCreate) {
			return fail('Forbidden', 403)
		}
		return message
	},
	respond: async (messages) => {
		const viewer = viewerKey(req)
		const [authors, decorated] = await Promise.all([
			projectAuthors(req, instance, messages),
			decorateMessages(req, instance, { messages, viewer }),
		])
		return {
			authors,
			messages: decorated.map((message) =>
				isRemoved(instance, message) ? { ...message, removed: true } : message
			),
		}
	},
	touch: (id) => touchMessage(req, { id, instance: instance.slug }),
	viewer: () => viewerKey(req),
})

/** Find a registered instance by slug on a booted Payload. */
export const getInstance = (
	req: Pick<PayloadRequest, 'payload'>,
	slug: string
): ConversationsInstance => {
	const registry = (req.payload.config.custom as { conversations?: InstanceRegistry } | undefined)
		?.conversations
	const instance = registry?.instances[slug]
	if (!instance) {
		throw new Error(`[@10x-media/conversations] no instance "${slug}" is registered`)
	}
	return instance
}

export type InstanceRegistry = { instances: Record<string, ConversationsInstance> }

export type PostMessageArgs = {
	/**
	 * A user key (`<collection>:<id>`), or `{ system: name }` for a system
	 * author (`systemAuthors`) when no person wrote it, e.g. an import. Default:
	 * `req.user`.
	 */
	author?: string | { system: string }
	body?: unknown
	channel: string
	data?: unknown
	/** Per extension, by name: what its `send` hook reads (`source: 'server'`). */
	ext?: Record<string, unknown>
	instance: string
	key: string
	parent?: null | string
	text?: string
	type?: string
}

/**
 * Create a message from server code, of any type, without instance access
 * checks. Collection hooks still run: validation, derived fields, counters,
 * `afterMessage` / `afterMention`.
 */
export const postMessage = async (
	req: PayloadRequest,
	args: PostMessageArgs
): Promise<ConversationMessage> => {
	const instance = getInstance(req, args.instance)
	const type = args.type ?? TEXT_TYPE
	const previous = req.context[AUTHOR_CONTEXT]
	if (args.author) {
		req.context[AUTHOR_CONTEXT] =
			typeof args.author === 'string' ? args.author : systemKey(args.author.system)
	}
	const body = type === TEXT_TYPE ? toBody(args) : undefined
	const fields = await extensionFields(req, instance, {
		channel: args.channel,
		ext: args.ext,
		key: args.key,
		parent: args.parent ?? null,
		source: 'server',
	})
	let message: ConversationMessage
	try {
		message = await createMessage(req, instance, {
			...fields,
			body,
			channel: args.channel,
			data: args.data,
			key: args.key,
			parent: args.parent ?? null,
			type,
		})
	} finally {
		req.context[AUTHOR_CONTEXT] = previous
	}
	// As after a send: the author has read up to their own message.
	const author = parseUserKey(message.authorKey)
	if (author && instance.users.some((entry) => entry.collection === author.collection)) {
		await raiseCursor(req, instance, {
			at: message.createdAt,
			channel: message.channel,
			key: message.key,
			thread: message.parent ?? '',
			userKey: message.authorKey,
		})
	}
	return message
}

/**
 * Move a message's `updatedAt` so pollers see it changed. Extensions keeping
 * their own collections (reactions, receipts) call this for anything they show
 * in a feed.
 */
export const touchMessage = async (
	req: PayloadRequest,
	args: { id: number | string; instance: string }
): Promise<void> => {
	const instance = getInstance(req, args.instance)
	await req.payload.db.updateOne({
		collection: instance.messagesSlug,
		data: { updatedAt: new Date().toISOString() },
		id: args.id,
		req,
		returning: false,
	})
	const message = await findRoot(req, instance, String(args.id))
	if (message) {
		await instance.transport?.publish({
			channel: message.channel,
			instance: instance.slug,
			key: message.key,
			req,
		})
	}
}
