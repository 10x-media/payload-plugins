import type { CollectionConfig, CollectionSlug, PayloadRequest, Where } from 'payload'

import { projectUsers } from '../server/authors'
import { ADMIN_GROUP } from '../shared/constants'
import type {
	ConversationMessage,
	ConversationsExtension,
	ConversationsInstance,
	ExtensionContext,
} from '../types'
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

/**
 * Emoji reactions on messages, for any instance. A general-purpose extension:
 * it adds a collection, a decorator that puts `ext.reactions` on every
 * message the endpoints return, two endpoints, and the bar and picker slots.
 *
 * Each reaction is its own row with a unique index on message, user and
 * emoji, so concurrent reactions never overwrite each other and adding one
 * twice is a no-op. Counts are computed when messages are read, one query
 * per page, so there is no counter to drift.
 */
export const reactions = (options: ReactionsOptions = {}): ConversationsExtension => {
	const emojis = options.emojis ?? DEFAULT_EMOJIS
	const afterReaction = options.hooks?.afterReaction
	const maxPerUser =
		options.maxPerUser && options.maxPerUser > 0 ? Math.floor(options.maxPerUser) : null
	const onLimit = options.onLimit ?? 'reject'
	const client: ReactionsClientData = { emojis, maxPerUser, onLimit }
	return {
		after: ({ config, instance }) => ({
			...config,
			collections: [...(config.collections ?? []), reactionsCollection(instance)],
		}),
		client,
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
			const rows = result.docs as unknown as ReactionRow[]
			if (rows.length === 0) return {}
			const names = await projectUsers(
				req,
				instance,
				rows.map((row) => row.userKey)
			)
			return summarize(rows, viewer, names)
		},
		endpoints: [
			{
				handler: async ({ ctx, instance, req }) => {
					const { emoji, message } = await readInput(ctx, emojis)
					const viewer = ctx.viewer()
					const target = await ctx.readableMessage(message)
					let added = true
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
						added = false
					}
					if (added && maxPerUser) {
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
							ctx.fail(`At most ${maxPerUser} reactions per person`, 409)
						}
						if (over > 0) {
							for (const old of own.filter((row) => row.emoji !== emoji).slice(0, over)) {
								await deleteRows(req, instance, rowWhere(message, viewer, old.emoji))
								await afterReaction?.({
									emoji: old.emoji,
									instance,
									message: target,
									operation: 'remove',
									req,
									userKey: viewer,
								})
							}
						}
					}
					if (added) {
						await ctx.touch(target.id)
						await afterReaction?.({
							emoji,
							instance,
							message: target,
							operation: 'add',
							req,
							userKey: viewer,
						})
					}
					return respond(ctx, message)
				},
				method: 'post',
				path: '/add',
			},
			{
				handler: async ({ ctx, instance, req }) => {
					const { emoji, message } = await readInput(ctx, emojis)
					const viewer = ctx.viewer()
					const target = await ctx.readableMessage(message, { deleted: true })
					const where = rowWhere(message, viewer, emoji)
					const existing = await req.payload.db.findOne({
						collection: slugOf(instance),
						req,
						where,
					})
					if (existing) {
						await deleteRows(req, instance, where)
						await ctx.touch(target.id)
						await afterReaction?.({
							emoji,
							instance,
							message: target,
							operation: 'remove',
							req,
							userKey: viewer,
						})
					}
					return respond(ctx, message)
				},
				method: 'post',
				path: '/remove',
			},
		],
		name: REACTIONS,
		onTargetDelete: ({ instance, key, req }) =>
			deleteRows(req, instance, { key: { equals: key } }).then(() => undefined),
		options,
		slots: {
			messageActions: '@10x-media/conversations/client#ReactionPicker',
			messageFooter: '@10x-media/conversations/client#ReactionsBar',
		},
	}
}

export { REACTIONS, type ReactionSummary, type ReactionsClientData } from './shared'
