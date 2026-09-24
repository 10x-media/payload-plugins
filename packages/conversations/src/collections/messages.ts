import { randomUUID } from 'node:crypto'
import {
	APIError,
	type CollectionAfterChangeHook,
	type CollectionBeforeChangeHook,
	type CollectionBeforeValidateHook,
	type CollectionConfig,
	type Field,
	type PayloadRequest,
} from 'payload'

import { buildConversationEditor } from '../editor/editor'
import { filterReaders } from '../server/audience'
import { bodyToText, disallowedLinks, extractMentions, isLexicalBody } from '../server/body'
import { ADMIN_GROUP, AUTHOR_CONTEXT, TEXT_TYPE } from '../shared/constants'
import { parseKey, parseUserKey, userKey } from '../shared/keys'
import type { ConversationMessage, ConversationsInstance } from '../types'

const closed = () => false

const badRequest = (message: string): never => {
	throw new APIError(message, 400, undefined, true)
}

/** The author of a new message: the server caller's choice, else the signed-in user. */
const resolveAuthor = (req: PayloadRequest): string => {
	const fromContext = req.context?.[AUTHOR_CONTEXT]
	if (typeof fromContext === 'string' && parseUserKey(fromContext)) {
		return fromContext
	}
	if (req.user) {
		return userKey(req.user.collection, req.user.id)
	}
	return badRequest('A message needs an author')
}

/**
 * Whether a deleted message is gone from feeds. Under `placeholderIfReplies`
 * that is every deleted reply and every deleted root without replies; under
 * `placeholder` nothing is ever gone.
 */
export const isRemoved = (
	instance: Pick<ConversationsInstance, 'deleted'>,
	message: Pick<ConversationMessage, 'deletedAt' | 'parent' | 'replyCount'>
): boolean =>
	Boolean(message.deletedAt) &&
	instance.deleted === 'placeholderIfReplies' &&
	(Boolean(message.parent) || (message.replyCount ?? 0) === 0)

/**
 * The messages collection of one instance. Its hooks hold the invariants, so a
 * message written through the Local API behaves like one sent through the
 * endpoints: channel and type validation, derived `text` and `mentions`, thread
 * counters, and the instance hooks.
 */
export const buildMessagesCollection = (instance: ConversationsInstance): CollectionConfig => {
	const slug = instance.messagesSlug

	const beforeValidate: CollectionBeforeValidateHook = async ({
		data = {},
		operation,
		originalDoc,
		req,
	}) => {
		if (operation === 'update') {
			// Where a message lives and who wrote it never change after it is written.
			for (const field of ['key', 'channel', 'parent', 'type', 'authorKey'] as const) {
				if (field in data && data[field] !== undefined && data[field] !== originalDoc?.[field]) {
					badRequest(`${field} cannot change`)
				}
			}
			return data
		}
		const target = parseKey(data.key)
		if (!target) {
			return badRequest('Invalid conversation key')
		}
		if (data.parent) {
			const root = (await req.payload.db.findOne({
				collection: slug,
				req,
				where: { id: { equals: data.parent } },
			})) as ConversationMessage | null
			if (!root || root.key !== data.key || root.parent || isRemoved(instance, root)) {
				return badRequest('A reply needs an existing root message in the same conversation')
			}
			data.parent = String(root.id)
			data.channel = root.channel
		} else {
			data.parent = null
		}
		if (typeof data.channel !== 'string' || !instance.channelsFor(target).includes(data.channel)) {
			return badRequest('Unknown channel for this conversation')
		}
		data.type = typeof data.type === 'string' && data.type ? data.type : TEXT_TYPE
		if (data.type !== TEXT_TYPE && !instance.types.has(data.type)) {
			return badRequest(`Unknown message type "${data.type}"`)
		}
		return data
	}

	const beforeChange: CollectionBeforeChangeHook = async ({
		data,
		operation,
		originalDoc,
		req,
	}) => {
		if (operation === 'create') {
			data.authorKey = resolveAuthor(req)
			data.clientId =
				typeof data.clientId === 'string' && data.clientId ? data.clientId : randomUUID()
			data.replyCount = data.parent ? null : 0
		}
		if (data.deletedAt) {
			data.body = null
			data.text = null
			data.mentions = []
			data.data = null
			return data
		}
		const merged = { ...(originalDoc ?? {}), ...data } as ConversationMessage
		if (merged.type !== TEXT_TYPE) {
			const definition = instance.types.get(merged.type)
			if (definition?.validate && (operation === 'create' || 'data' in data)) {
				const result = await definition.validate(data.data)
				if (result !== true) {
					badRequest(typeof result === 'string' ? result : 'Invalid message data')
				}
			}
			return data
		}
		if (operation === 'update' && !('body' in data)) {
			return data
		}
		if (!isLexicalBody(data.body)) {
			return badRequest('A text message needs a body')
		}
		if (disallowedLinks(data.body).length > 0) {
			badRequest('Links must use http, https or mailto')
		}
		const text = bodyToText(data.body)
		const mentioned = extractMentions(data.body).slice(0, instance.mentions.max)
		if (text.length === 0 && mentioned.length === 0) {
			badRequest('A message cannot be empty')
		}
		if (text.length > instance.limits.bodyLength) {
			badRequest(`A message is limited to ${instance.limits.bodyLength} characters`)
		}
		data.text = text
		data.mentions = await filterReaders(req, instance, {
			channel: merged.channel,
			key: merged.key,
			userKeys: mentioned,
		})
		return data
	}

	const afterChange: CollectionAfterChangeHook = async ({ doc, operation, previousDoc, req }) => {
		const message = doc as ConversationMessage
		const previous = previousDoc as ConversationMessage | undefined
		const deletedNow = operation === 'update' && !previous?.deletedAt && Boolean(message.deletedAt)

		if (message.parent && (operation === 'create' || deletedNow)) {
			// One atomic statement on both adapters, so concurrent replies never lose a
			// count. It joins the request's transaction when there is one; the plugin's
			// own writes run without one (see `writeOptions`), because on Mongo two
			// transactions writing the same root abort each other with WriteConflict.
			await req.payload.db.updateOne({
				collection: slug,
				data: {
					replyCount: { $inc: operation === 'create' ? 1 : -1 },
					updatedAt: new Date().toISOString(),
					...(operation === 'create' ? { lastReplyAt: message.createdAt } : {}),
				},
				id: message.parent,
				req,
				returning: false,
			})
		}

		await instance.hooks.afterMessage?.({
			message,
			operation: deletedNow ? 'delete' : operation,
			req,
		})

		if (!message.deletedAt && instance.hooks.afterMention) {
			const before = new Set(operation === 'update' ? (previous?.mentions ?? []) : [])
			const users = (message.mentions ?? [])
				.filter((mentioned) => !before.has(mentioned))
				.map(parseUserKey)
				.filter((ref) => ref !== null)
			if (users.length > 0) {
				await instance.hooks.afterMention({
					channel: message.channel,
					key: message.key,
					message,
					req,
					users,
				})
			}
		}

		await instance.transport?.publish({ instance: instance.slug, key: message.key, req })
		return doc
	}

	const defaultFields: Field[] = [
		{ index: true, name: 'key', required: true, type: 'text' },
		{ name: 'channel', required: true, type: 'text' },
		{ index: true, name: 'parent', type: 'text' },
		{ defaultValue: TEXT_TYPE, name: 'type', required: true, type: 'text' },
		{ editor: buildConversationEditor(instance), label: false, name: 'body', type: 'richText' },
		{ name: 'data', type: 'json' },
		{ admin: { readOnly: true }, name: 'text', type: 'textarea' },
		{ admin: { readOnly: true }, hasMany: true, name: 'mentions', type: 'text' },
		{ admin: { readOnly: true }, index: true, name: 'authorKey', required: true, type: 'text' },
		{ admin: { readOnly: true }, name: 'clientId', type: 'text', unique: true },
		{ admin: { readOnly: true }, name: 'editedAt', type: 'date' },
		{ admin: { readOnly: true }, name: 'deletedAt', type: 'date' },
		{ admin: { readOnly: true }, name: 'replyCount', type: 'number' },
		{ admin: { readOnly: true }, name: 'lastReplyAt', type: 'date' },
	]

	const override = instance.overrides.messages ?? {}
	return {
		access: {
			create: closed,
			delete: closed,
			read: closed,
			readVersions: closed,
			unlock: closed,
			update: closed,
			...override.access,
		},
		admin: { group: ADMIN_GROUP, hidden: true, useAsTitle: 'text', ...override.admin },
		fields: override.fields ? override.fields({ defaultFields }) : defaultFields,
		hooks: {
			...override.hooks,
			afterChange: [afterChange, ...(override.hooks?.afterChange ?? [])],
			beforeChange: [beforeChange, ...(override.hooks?.beforeChange ?? [])],
			beforeValidate: [beforeValidate, ...(override.hooks?.beforeValidate ?? [])],
		},
		indexes: [
			{ fields: ['key', 'channel', 'parent', 'createdAt'] },
			{ fields: ['key', 'updatedAt'] },
		],
		slug,
		timestamps: true,
	}
}
