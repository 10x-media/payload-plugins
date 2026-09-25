import type { CollectionConfig, CollectionSlug, Field, PayloadRequest, Where } from 'payload'

import { projectUsers } from '../server/authors'
import { ADMIN_GROUP } from '../shared/constants'
import type {
	ConversationMessage,
	ConversationsExtension,
	ConversationsInstance,
	ExtensionContext,
	ExtensionEndpoint,
} from '../types'
import { applyReaction, type ReactionChange, readStored } from './embedded'
import { REACTIONS, type ReactionRow, type ReactionsClientData, summarize } from './shared'

export type ReactionsOptions = {
	/** The emoji people can pick, in picker order. */
	emojis?: string[]
	/** How many different emoji one person may put on one message. Default: no limit. */
	maxPerUser?: number
	/**
	 * At the limit, a new reaction is refused (`reject`, default) or takes the
	 * place of the person's oldest one on that message (`replace`; with
	 * `maxPerUser: 1` a reaction simply changes).
	 */
	onLimit?: 'reject' | 'replace'
	/**
	 * Where reactions live. `collection` (default): one row each in an
	 * `<instance>-reactions` collection, one extra query per page. `message`:
	 * a JSON field on the message itself, no extra collection and no extra
	 * query. Concurrent reactions on one message are serialized either way
	 * (for `message`: a versioned compare-and-set on Mongo, a row lock in a
	 * transaction on SQL), so none is lost.
	 */
	storage?: 'collection' | 'message'
	hooks?: {
		/**
		 * After a reaction was really added or removed (not on a repeated add or
		 * a remove of nothing), e.g. to notify the message's author. Errors are
		 * the host's: they fail the request after the change is saved.
		 */
		afterReaction?: (args: {
			emoji: string
			instance: ConversationsInstance
			message: ConversationMessage
			operation: 'add' | 'remove'
			req: PayloadRequest
			/** Who reacted. */
			userKey: string
		}) => Promise<void> | void
	}
}

export const DEFAULT_EMOJIS = ['👍', '❤️', '😂', '🎉', '👀', '✅']

const closed = () => false

const slugOf = (instance: ConversationsInstance) => `${instance.slug}-reactions` as CollectionSlug

/** One row per user, emoji and message; the unique index is what makes adding atomic. */
const reactionsCollection = (instance: ConversationsInstance): CollectionConfig => ({
	access: { create: closed, delete: closed, read: closed, update: closed },
	admin: { group: ADMIN_GROUP, hidden: true },
	fields: [
		{ index: true, name: 'message', required: true, type: 'text' },
		{ index: true, name: 'key', required: true, type: 'text' },
		{ name: 'userKey', required: true, type: 'text' },
		{ name: 'emoji', required: true, type: 'text' },
	],
	indexes: [{ fields: ['message', 'userKey', 'emoji'], unique: true }],
	slug: slugOf(instance),
})

/** Mongo's duplicate key (11000) or Postgres' unique violation (23505), however it is wrapped. */
const isDuplicate = (error: unknown): boolean => {
	const seen = new Set<unknown>()
	let current: unknown = error
	while (current && typeof current === 'object' && !seen.has(current)) {
		seen.add(current)
		const record = current as { cause?: unknown; code?: unknown; name?: unknown }
		if (record.code === 11000 || record.code === '23505' || record.name === 'ValidationError') {
			return true
		}
		current = record.cause
	}
	return false
}

const readInput = async (ctx: ExtensionContext, emojis: string[]) => {
	const body = await ctx.body()
	const message =
		typeof body.message === 'string' || typeof body.message === 'number' ? String(body.message) : ''
	const emoji = typeof body.emoji === 'string' ? body.emoji : ''
	if (!message) ctx.fail('message is required', 400)
	if (!emojis.includes(emoji)) ctx.fail('Unknown reaction', 400)
	return { emoji, message }
}

const rowWhere = (message: string, userKey: string, emoji: string): Where => ({
	and: [
		{ message: { equals: message } },
		{ userKey: { equals: userKey } },
		{ emoji: { equals: emoji } },
	],
})

const respond = async (ctx: ExtensionContext, id: string) => {
	const { authors, messages } = await ctx.respond([
		await ctx.readableMessage(id, { deleted: true }),
	])
	return Response.json({ authors, message: messages[0] })
}

const deleteRows = (req: PayloadRequest, instance: ConversationsInstance, where: Where) =>
	req.payload.db.deleteMany({ collection: slugOf(instance), req, where })

/** One reaction change on one message, as a storage carries it out. */
type ChangeArgs = {
	ctx: ExtensionContext
	emoji: string
	instance: ConversationsInstance
	operation: 'add' | 'remove'
	req: PayloadRequest
	target: ConversationMessage
	viewer: string
}

type Limits = { maxPerUser: null | number; onLimit: 'reject' | 'replace' }

/** Where reactions are written, read and cleaned up. */
type Storage = {
	/** Carry out a change and name what really changed. Fails with 409 past the limit. */
	change: (args: ChangeArgs) => Promise<Pick<ReactionChange, 'added' | 'removed'>>
	collection: boolean
	decorate: NonNullable<ConversationsExtension['decorate']>
	messageFields?: Field[]
	onTargetDelete?: ConversationsExtension['onTargetDelete']
	/** Let pollers see a change. */
	signal: (args: ChangeArgs) => Promise<void>
}

const summarizeRows = async (
	req: PayloadRequest,
	instance: ConversationsInstance,
	{ rows, viewer }: { rows: ReactionRow[]; viewer: string }
) => {
	if (rows.length === 0) return {}
	const names = await projectUsers(
		req,
		instance,
		rows.map((row) => row.userKey)
	)
	return summarize(rows, viewer, names)
}

const limitReached = (ctx: ExtensionContext, maxPerUser: null | number): never =>
	ctx.fail(`At most ${maxPerUser} reactions per person`, 409)

/**
 * One row per reaction with a unique index on message, user and emoji, so
 * concurrent reactions never overwrite each other and adding one twice is a
 * no-op. Counts are computed when messages are read, one query per page, so
 * there is no counter to drift.
 */
const collectionStorage = ({ maxPerUser, onLimit }: Limits): Storage => ({
	change: async ({ ctx, emoji, instance, operation, req, target, viewer }) => {
		const message = String(target.id)
		if (operation === 'remove') {
			const where = rowWhere(message, viewer, emoji)
			const existing = await req.payload.db.findOne({ collection: slugOf(instance), req, where })
			if (!existing) return { added: null, removed: [] }
			await deleteRows(req, instance, where)
			return { added: null, removed: [emoji] }
		}
		try {
			await req.payload.db.create({
				collection: slugOf(instance),
				data: { emoji, key: target.key, message, userKey: viewer },
				req,
				returning: false,
			})
		} catch (error) {
			// Already there: adding is idempotent.
			if (!isDuplicate(error)) throw error
			return { added: null, removed: [] }
		}
		const removed: string[] = []
		if (maxPerUser) {
			// Checked after the insert, so concurrent adds never end above the limit.
			const own = (
				await req.payload.find({
					collection: slugOf(instance),
					depth: 0,
					overrideAccess: true,
					pagination: false,
					req,
					sort: 'createdAt',
					where: { and: [{ message: { equals: message } }, { userKey: { equals: viewer } }] },
				})
			).docs as unknown as ReactionRow[]
			const over = own.length - maxPerUser
			if (over > 0 && onLimit === 'reject') {
				await deleteRows(req, instance, rowWhere(message, viewer, emoji))
				limitReached(ctx, maxPerUser)
			}
			if (over > 0) {
				for (const old of own.filter((row) => row.emoji !== emoji).slice(0, over)) {
					await deleteRows(req, instance, rowWhere(message, viewer, old.emoji))
					removed.push(old.emoji)
				}
			}
		}
		return { added: emoji, removed }
	},
	collection: true,
	decorate: async ({ instance, messages, req, viewer }) => {
		// Deleted messages keep their reactions; rows go only with the target.
		const ids = messages.map((message) => String(message.id))
		if (ids.length === 0) return {}
		const result = await req.payload.find({
			collection: slugOf(instance),
			depth: 0,
			overrideAccess: true,
			pagination: false,
			req,
			sort: 'createdAt',
			where: { message: { in: ids } },
		})
		return summarizeRows(req, instance, {
			rows: result.docs as unknown as ReactionRow[],
			viewer,
		})
	},
	onTargetDelete: ({ instance, key, req }) =>
		deleteRows(req, instance, { key: { equals: key } }).then(() => undefined),
	signal: ({ ctx, target }) => ctx.touch(target.id),
})

const FIELD = 'reactions'
const VERSION = 'reactionsVersion'
const CAS_ATTEMPTS = 8

type StoredMessage = { [FIELD]?: unknown; [VERSION]?: null | number }

const versionOf = (stored: StoredMessage): null | number =>
	typeof stored[VERSION] === 'number' ? stored[VERSION] : null

const pause = (attempt: number) =>
	new Promise((resolve) => setTimeout(resolve, Math.random() * 10 * (attempt + 1)))

/**
 * Reactions in a JSON field on the message. A write reads the list, applies
 * the change and writes it back, serialized per message: on Mongo as a
 * compare-and-set on a version number (one atomic `findOneAndUpdate`, retried
 * on a lost race); on SQL adapters, whose conditional update is a select then
 * an update, under the row lock an update takes inside a transaction.
 */
const messageStorage = (limits: Limits): Storage => {
	const apply = (stored: StoredMessage, { emoji, operation, viewer }: ChangeArgs) =>
		applyReaction(readStored(stored[FIELD]), {
			...limits,
			at: new Date().toISOString(),
			emoji,
			operation,
			userKey: viewer,
		})

	const compareAndSet = async (args: ChangeArgs) => {
		const { ctx, instance, req, target } = args
		for (let attempt = 0; attempt < CAS_ATTEMPTS; attempt++) {
			const stored = (await req.payload.db.findOne({
				collection: instance.messagesSlug,
				where: { id: { equals: target.id } },
			})) as null | StoredMessage
			if (!stored) return ctx.fail('Not found', 404)
			const result = apply(stored, args)
			if (result === 'limit') return limitReached(ctx, limits.maxPerUser)
			if (!result.added && result.removed.length === 0) return result
			const version = versionOf(stored)
			const written = await req.payload.db.updateOne({
				collection: instance.messagesSlug,
				data: {
					[FIELD]: result.next,
					[VERSION]: (version ?? 0) + 1,
					updatedAt: new Date().toISOString(),
				},
				where: { and: [{ id: { equals: target.id } }, { [VERSION]: { equals: version } }] },
			})
			if (written) return result
			await pause(attempt)
		}
		return ctx.fail('The message is busy, try again', 409)
	}

	const underLock = async (args: ChangeArgs) => {
		const { ctx, instance, req, target } = args
		const db = req.payload.db
		const transactionID = (await db.beginTransaction()) ?? undefined
		const inTransaction = { payload: req.payload, transactionID } as PayloadRequest
		try {
			// Any update takes the row lock; a concurrent change waits here until this one commits.
			await db.updateOne({
				collection: instance.messagesSlug,
				data: { updatedAt: new Date().toISOString() },
				id: target.id,
				req: inTransaction,
				returning: false,
			})
			const stored = (await db.findOne({
				collection: instance.messagesSlug,
				req: inTransaction,
				where: { id: { equals: target.id } },
			})) as null | StoredMessage
			if (!stored) return ctx.fail('Not found', 404)
			const result = apply(stored, args)
			if (result === 'limit') return limitReached(ctx, limits.maxPerUser)
			if (result.added || result.removed.length > 0) {
				await db.updateOne({
					collection: instance.messagesSlug,
					data: { [FIELD]: result.next, [VERSION]: (versionOf(stored) ?? 0) + 1 },
					id: target.id,
					req: inTransaction,
					returning: false,
				})
			}
			if (transactionID !== undefined) await db.commitTransaction(transactionID)
			return result
		} catch (error) {
			if (transactionID !== undefined) await db.rollbackTransaction(transactionID)
			throw error
		}
	}

	return {
		change: (args) =>
			args.req.payload.db.name === 'mongoose' ? compareAndSet(args) : underLock(args),
		collection: false,
		decorate: ({ instance, messages, req, viewer }) =>
			summarizeRows(req, instance, {
				rows: messages.flatMap((message) =>
					readStored((message as StoredMessage)[FIELD]).map((entry) => ({
						createdAt: entry.at,
						emoji: entry.emoji,
						message: String(message.id),
						userKey: entry.userKey,
					}))
				),
				viewer,
			}),
		messageFields: [
			{ admin: { hidden: true }, name: FIELD, type: 'json' },
			{ admin: { hidden: true }, name: VERSION, type: 'number' },
		],
		// The write has moved `updatedAt` already.
		signal: async ({ instance, req, target }) => {
			await instance.transport?.publish({
				channel: target.channel,
				instance: instance.slug,
				key: target.key,
				req,
			})
		},
	}
}

/**
 * Emoji reactions on messages, for any instance. A general-purpose extension:
 * a decorator that puts `ext.reactions` on every message the endpoints
 * return, two endpoints, the bar and picker slots, and a storage that is its
 * own collection or a field on the message (`storage`). The browser sees the
 * same data either way.
 */
export const reactions = (options: ReactionsOptions = {}): ConversationsExtension => {
	const emojis = options.emojis ?? DEFAULT_EMOJIS
	const afterReaction = options.hooks?.afterReaction
	const maxPerUser =
		options.maxPerUser && options.maxPerUser > 0 ? Math.floor(options.maxPerUser) : null
	const onLimit = options.onLimit ?? 'reject'
	const client: ReactionsClientData = { emojis, maxPerUser, onLimit }
	const storage =
		options.storage === 'message'
			? messageStorage({ maxPerUser, onLimit })
			: collectionStorage({ maxPerUser, onLimit })

	const handler =
		(operation: 'add' | 'remove'): ExtensionEndpoint['handler'] =>
		async ({ ctx, instance, req }) => {
			const { emoji, message } = await readInput(ctx, emojis)
			const viewer = ctx.viewer()
			// A deleted message takes no new reactions, but its own can still go.
			const target = await ctx.readableMessage(message, { deleted: operation === 'remove' })
			const args: ChangeArgs = { ctx, emoji, instance, operation, req, target, viewer }
			const { added, removed } = await storage.change(args)
			if (added || removed.length > 0) {
				await storage.signal(args)
			}
			for (const gone of removed) {
				await afterReaction?.({
					emoji: gone,
					instance,
					message: target,
					operation: 'remove',
					req,
					userKey: viewer,
				})
			}
			if (added) {
				await afterReaction?.({
					emoji: added,
					instance,
					message: target,
					operation: 'add',
					req,
					userKey: viewer,
				})
			}
			return respond(ctx, message)
		}

	return {
		...(storage.collection
			? {
					after: ({ config, instance }) => ({
						...config,
						collections: [...(config.collections ?? []), reactionsCollection(instance)],
					}),
				}
			: {}),
		client,
		decorate: storage.decorate,
		endpoints: [
			{ handler: handler('add'), method: 'post', path: '/add' },
			{ handler: handler('remove'), method: 'post', path: '/remove' },
		],
		messageFields: storage.messageFields,
		name: REACTIONS,
		onTargetDelete: storage.onTargetDelete,
		options,
		slots: {
			messageQuickActions: '@10x-media/conversations/client#ReactionQuickActions',
			messageFooter: '@10x-media/conversations/client#ReactionsBar',
		},
	}
}

export { REACTIONS, type ReactionSummary, type ReactionsClientData } from './shared'
