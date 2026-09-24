import { APIError, type PayloadRequest, type Where } from 'payload'

import { isRemoved } from '../collections/messages'
import { AUTHOR_CONTEXT, TEXT_TYPE } from '../shared/constants'
import { userKey as formatUserKey, type ParsedKey, parseKey } from '../shared/keys'
import type {
	ChannelAccess,
	ListResponse,
	MentionCandidate,
	SubscribeResponse,
	WireMessage,
} from '../shared/wire'
import type { AuthorsMap, ConversationMessage, ConversationsInstance } from '../types'
import { filterReaders } from './audience'
import { projectAuthors } from './authors'
import { isLexicalBody, textToBody } from './body'
import { changedKeys, type FeedWindow, loadFeed } from './feed'
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
 * Effective access for many keys: conversation access once for the batch,
 * then channel `read` / `create` per offered channel. Keys the user may not
 * see, or with no readable channel, are left out.
 */
export const resolveAccess = async (
	req: PayloadRequest,
	instance: ConversationsInstance,
	keys: string[]
): Promise<Map<string, KeyAccess>> => {
	const allowed = await instance.allowedKeys(req, keys)
	const out = new Map<string, KeyAccess>()
	await Promise.all(
		[...allowed].map(async (key) => {
			const target = parseKey(key)
			if (!target) {
				return
			}
			const channels: ChannelAccess[] = []
			for (const slug of instance.channelsFor(target)) {
				const channel = instance.channels.get(slug)
				if (!channel || !(await channel.access.read({ key, req, target }))) {
					continue
				}
				channels.push({ canCreate: await channel.access.create({ key, req, target }), slug })
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

/** Batch access for mounted conversations: channels, unread counts, poll tokens. */
export const subscribe = async (
	req: PayloadRequest,
	instance: ConversationsInstance,
	keys: string[]
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
	const exp = Date.now() + TOKEN_TTL_MS
	return {
		entries: list.map((entry) => ({
			channels: entry.channels,
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
			[...instance.channels.values()].map((channel) => [
				channel.slug,
				{ label: channel.label, ...(channel.cue ? { cue: channel.cue } : {}) },
			])
		),
		deleted: instance.deleted,
		extensions: [...instance.extensions.keys()],
		now: new Date().toISOString(),
		reads: instance.readsSlug !== null,
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
				cursor =
					(await conversationCursors(req, instance, { keys: [params.key], userKey: viewer })).get(
						params.key
					) ?? null
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
			if (unread.totalDocs > params.limit) {
				window = { around: cursor, mode: 'around' }
			}
		}
	}
	const feed = await loadFeed(req, instance, {
		channels,
		key: params.key,
		limit: params.limit,
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
		messages: feed.messages,
		threadReads,
	}
}

export type SendInput = {
	body?: unknown
	channel?: string
	clientId?: string
	data?: unknown
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
): Promise<{ authors: AuthorsMap; message: ConversationMessage }> => {
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
			return { authors: await projectAuthors(req, instance, [existing]), message: existing }
		}
	}
	const message = await createMessage(req, instance, {
		body: type === TEXT_TYPE ? toBody(input) : undefined,
		channel,
		clientId: input.clientId,
		data: type === TEXT_TYPE ? undefined : input.data,
		key: input.key,
		parent: input.parent ?? null,
		type,
	})
	await raiseCursor(req, instance, {
		at: message.createdAt,
		key: message.key,
		thread: message.parent ?? '',
		userKey: message.authorKey,
	})
	return { authors: await projectAuthors(req, instance, [message]), message }
}

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
	if (!access.channels.some((entry) => entry.slug === message.channel)) {
		return fail('Not found', 404)
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
	const message = (await req.payload.update({
		collection: instance.messagesSlug,
		...writeOptions,
		data: { body: toBody(input), editedAt: new Date().toISOString() },
		id: existing.id,
		req,
	})) as unknown as ConversationMessage
	return { authors: await projectAuthors(req, instance, [message]), message }
}

/** Soft-delete: content is wiped on the server, the row stays for counters and placeholders. */
export const deleteMessage = async (
	req: PayloadRequest,
	instance: ConversationsInstance,
	id: string
): Promise<{ message: WireMessage }> => {
	const existing = await loadOwned(req, instance, { action: 'delete', id })
	const message = (await req.payload.update({
		collection: instance.messagesSlug,
		...writeOptions,
		data: { deletedAt: new Date().toISOString() },
		id: existing.id,
		req,
	})) as unknown as ConversationMessage
	return { message: isRemoved(instance, message) ? { ...message, removed: true } : message }
}

/** Raise the viewer's cursor for a conversation or one thread of it. */
export const markRead = async (
	req: PayloadRequest,
	instance: ConversationsInstance,
	input: { at?: unknown; key: string; thread?: unknown }
): Promise<void> => {
	const viewer = viewerKey(req)
	if (!instance.readsSlug) {
		return
	}
	await accessFor(req, instance, input.key)
	const at = new Date(typeof input.at === 'string' ? input.at : Date.now())
	if (Number.isNaN(at.getTime())) {
		fail('Invalid time', 400)
	}
	const now = Date.now()
	await raiseCursor(req, instance, {
		at: at.getTime() > now ? new Date(now) : at,
		key: input.key,
		thread: typeof input.thread === 'string' ? input.thread : '',
		userKey: viewer,
	})
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

/** Mention candidates across the users collections, minus anyone who cannot read the channel. */
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
				collection: users.collection,
				depth: 0,
				limit: perCollection,
				overrideAccess: true,
				pagination: false,
				req,
				where: where.length > 0 ? { and: where } : {},
			})
			return (result.docs as Array<Record<string, unknown>>).map((doc) => ({
				doc,
				userKey: formatUserKey(users.collection, doc.id as string),
				users,
			}))
		})
	)
	const flat = found.flat()
	const readers = new Set(
		await filterReaders(req, instance, {
			channel: input.channel,
			key: input.key,
			userKeys: flat.map((entry) => entry.userKey),
		})
	)
	return flat
		.filter((entry) => readers.has(entry.userKey))
		.map((entry) => {
			const projected = entry.users.display(entry.doc)
			return { avatar: projected.avatar ?? null, name: projected.name, userKey: entry.userKey }
		})
}

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
	/** A user key (`<collection>:<id>`). Default: `req.user`. */
	author?: string
	body?: unknown
	channel: string
	data?: unknown
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
		req.context[AUTHOR_CONTEXT] = args.author
	}
	try {
		return await createMessage(req, instance, {
			body: type === TEXT_TYPE ? toBody(args) : undefined,
			channel: args.channel,
			data: args.data,
			key: args.key,
			parent: args.parent ?? null,
			type,
		})
	} finally {
		req.context[AUTHOR_CONTEXT] = previous
	}
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
		await instance.transport?.publish({ instance: instance.slug, key: message.key, req })
	}
}
