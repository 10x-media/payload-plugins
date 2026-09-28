import type {
	CollectionBeforeValidateHook,
	CollectionConfig,
	CollectionSlug,
	Config,
	PayloadRequest,
} from 'payload'

import { isDocumentId } from '../server/ids'
import { ADMIN_GROUP } from '../shared/constants'
import type {
	CollectionOverride,
	ConversationMessage,
	ConversationsExtension,
	ConversationsInstance,
} from '../types'
import {
	ATTACHMENT_CHANNEL_HEADER,
	ATTACHMENT_HEADER,
	ATTACHMENT_KEY_HEADER,
	ATTACHMENTS,
	type AttachmentsClientData,
	type AttachmentView,
} from './shared'

type Doc = Record<string, unknown>

export type AttachmentsOptions = {
	/**
	 * An upload collection of your own (`'media'`) instead of the extension's.
	 * Its access decides who uploads and reads, as always; its required fields
	 * are yours to fill in `data`.
	 */
	collection?: string
	/**
	 * Fields for a file a composer uploads, merged into the new document before
	 * validation: what the collection requires beyond the file (`alt`, a
	 * folder, a tenant). Runs for composer uploads only. `key` and `channel`
	 * come from the browser: use them to fill fields, never to grant access.
	 */
	data?: (args: {
		channel: null | string
		data: Doc
		file: { mimetype?: string; name?: string; size?: number } | undefined
		instance: ConversationsInstance
		key: null | string
		req: PayloadRequest
	}) => Doc | Promise<Doc | undefined> | undefined
	/**
	 * Delete a message's files with it: when the message is deleted and when
	 * its target goes (`deleteWithTarget`). Default `false`: the files stay in
	 * the collection. A file attached to several messages goes with the first.
	 */
	deleteWithMessage?: boolean
	/** Most files on one message. Default 10. */
	maxFiles?: number
	/**
	 * The extension's own collection (without `collection`): slug (default
	 * `<instance>-attachments`), `upload` settings (default `true`: Payload's
	 * defaults, any file type) and the usual access, admin, fields and hooks.
	 * `create` and `read` default to Payload's: any signed-in user, customers
	 * included. `update` and `delete` are closed unless `access` opens them.
	 */
	overrides?: CollectionOverride & { slug?: string; upload?: CollectionConfig['upload'] }
	/**
	 * A smaller image for the message, e.g. one of the collection's
	 * `imageSizes`: `(doc) => doc.sizes?.thumbnail?.url`. Default: none, the
	 * message shows `url`.
	 */
	thumbnail?: (doc: Doc) => null | string | undefined
}

/** Where a message keeps its file ids: a JSON array, in attach order. */
const FIELD = 'attachments'

const DEFAULT_MAX_FILES = 10

const closed = () => false

const stringOr = (value: unknown): null | string => (typeof value === 'string' ? value : null)
const numberOr = (value: unknown): null | number =>
	typeof value === 'number' && Number.isFinite(value) ? value : null

const isId = (value: unknown): value is number | string =>
	(typeof value === 'string' && value.length > 0) || (typeof value === 'number' && value > 0)

/** The ids stored on a message. */
const storedIds = (message: ConversationMessage): Array<number | string> => {
	const value = (message as ConversationMessage & { [FIELD]?: unknown })[FIELD]
	return Array.isArray(value) ? value.filter(isId) : []
}

const mimeTypesOf = (collection: CollectionConfig): string[] =>
	typeof collection.upload === 'object' && Array.isArray(collection.upload.mimeTypes)
		? collection.upload.mimeTypes
		: []

/**
 * Files on messages. Files go to an upload collection through its own REST
 * endpoint, under its access; a send carries their ids (`ext.attachments`),
 * which the server checks the sender can read before storing them on the
 * message. Every response shows them as `message.ext.attachments`.
 */
export const attachments = (options: AttachmentsOptions = {}): ConversationsExtension => {
	if (options.collection && options.overrides) {
		throw new Error(
			"[@10x-media/conversations] attachments(): `overrides` configure the extension's own collection; with `collection` set, configure that collection itself"
		)
	}
	const maxFiles =
		options.maxFiles && options.maxFiles > 0 ? Math.floor(options.maxFiles) : DEFAULT_MAX_FILES
	const client: AttachmentsClientData = { collection: '', maxFiles, mimeTypes: [] }
	// Known once the instance is resolved (`after`); every hook below runs later.
	let slug = '' as CollectionSlug

	const fillData =
		(instance: ConversationsInstance): CollectionBeforeValidateHook =>
		async ({ data, operation, req }) => {
			if (operation !== 'create' || !options.data) return data
			if (req.headers?.get(ATTACHMENT_HEADER) !== instance.slug) return data
			const extra = await options.data({
				channel: req.headers.get(ATTACHMENT_CHANNEL_HEADER),
				data: data ?? {},
				file: req.file,
				instance,
				key: req.headers.get(ATTACHMENT_KEY_HEADER),
				req,
			})
			return extra ? { ...data, ...extra } : data
		}

	const ownCollection = (instance: ConversationsInstance): CollectionConfig => {
		const override = options.overrides ?? {}
		return {
			// Files are never changed or removed over REST unless the host opens it; the
			// extension itself deletes with `overrideAccess` (`deleteWithMessage`).
			access: { delete: closed, update: closed, ...override.access },
			admin: { group: ADMIN_GROUP, ...override.admin },
			fields: override.fields ? override.fields({ defaultFields: [] }) : [],
			hooks: {
				...override.hooks,
				beforeValidate: [fillData(instance), ...(override.hooks?.beforeValidate ?? [])],
			},
			slug: override.slug ?? `${instance.slug}-attachments`,
			upload: override.upload ?? true,
		}
	}

	const withCollection = (config: Config, instance: ConversationsInstance): Config => {
		if (!options.collection) {
			const own = ownCollection(instance)
			slug = own.slug as CollectionSlug
			client.mimeTypes = mimeTypesOf(own)
			return { ...config, collections: [...(config.collections ?? []), own] }
		}
		const existing = config.collections?.find((entry) => entry.slug === options.collection)
		if (!existing?.upload) {
			throw new Error(
				`[@10x-media/conversations] attachments(): "${options.collection}" is not an upload collection`
			)
		}
		slug = existing.slug as CollectionSlug
		client.mimeTypes = mimeTypesOf(existing)
		if (!options.data) return config
		return {
			...config,
			collections: (config.collections ?? []).map((entry) =>
				entry === existing
					? {
							...entry,
							hooks: {
								...entry.hooks,
								beforeValidate: [fillData(instance), ...(entry.hooks?.beforeValidate ?? [])],
							},
						}
					: entry
			),
		}
	}

	const view = (doc: Doc): AttachmentView => ({
		filename: stringOr(doc.filename) ?? 'file',
		filesize: numberOr(doc.filesize),
		height: numberOr(doc.height),
		id: doc.id as number | string,
		mimeType: stringOr(doc.mimeType),
		thumbnail: options.thumbnail?.(doc) ?? null,
		url: stringOr(doc.url),
		width: numberOr(doc.width),
	})

	const deleteFiles = async (req: PayloadRequest, ids: Array<number | string>) => {
		if (ids.length === 0) return
		// Through the Local API, so the collection's hooks remove the stored files too.
		await req.payload.delete({
			collection: slug,
			overrideAccess: true,
			req,
			where: { id: { in: ids } },
		})
	}

	return {
		after: ({ config, instance }) => {
			const next = withCollection(config, instance)
			client.collection = slug
			return next
		},
		client,
		decorate: async ({ messages, req }) => {
			// A deleted message shows no files, whether or not they were removed.
			const lists = messages
				.filter((message) => !message.deletedAt)
				.map((message) => [String(message.id), storedIds(message)] as const)
				.filter(([, ids]) => ids.length > 0)
			const ids = [...new Set(lists.flatMap(([, list]) => list.map(String)))]
			if (ids.length === 0) return {}
			const found = await req.payload.find({
				collection: slug,
				depth: 0,
				overrideAccess: true,
				pagination: false,
				req,
				where: { id: { in: ids } },
			})
			const views = new Map(found.docs.map((doc) => [String(doc.id), view(doc as unknown as Doc)]))
			return Object.fromEntries(
				lists.map(([id, list]) => [id, list.flatMap((file) => views.get(String(file)) ?? [])])
			)
		},
		messageFields: [{ admin: { hidden: true }, name: FIELD, type: 'json' }],
		name: ATTACHMENTS,
		onMessageDelete: options.deleteWithMessage
			? ({ message, req }) => deleteFiles(req, storedIds(message))
			: undefined,
		onTargetDelete: options.deleteWithMessage
			? async ({ instance, key, req }) => {
					const result = await req.payload.find({
						collection: instance.messagesSlug,
						depth: 0,
						overrideAccess: true,
						pagination: false,
						req,
						select: { [FIELD]: true },
						where: { key: { equals: key } },
					})
					await deleteFiles(req, [
						...new Set(
							(result.docs as unknown as ConversationMessage[]).flatMap((doc) => storedIds(doc))
						),
					])
				}
			: undefined,
		options,
		send: async ({ fail, input, req, source }) => {
			if (input === undefined || input === null) return undefined
			if (!Array.isArray(input) || !input.every(isId)) {
				return fail('attachments must be a list of file ids', 400)
			}
			const ids = [...new Set(input.map(String))]
			if (ids.length === 0) return undefined
			// A malformed id would make the database throw rather than find nothing.
			if (!ids.every((id) => isDocumentId(req, slug, id))) {
				return fail('Unknown file', 400)
			}
			if (ids.length > maxFiles) {
				return fail(`At most ${maxFiles} files per message`, 400)
			}
			// Only files the sender may read: attaching shows them to everyone in the channel.
			const found = await req.payload.find({
				collection: slug,
				depth: 0,
				limit: ids.length,
				overrideAccess: source === 'server',
				pagination: false,
				req,
				where: { id: { in: ids } },
			})
			const byId = new Map(found.docs.map((doc) => [String(doc.id), doc.id]))
			if (ids.some((id) => !byId.has(id))) {
				return fail('Unknown file', 400)
			}
			return { [FIELD]: ids.map((id) => byId.get(id)) }
		},
		slots: {
			composerActions: '@10x-media/conversations/client#AttachButton',
			composerBelow: '@10x-media/conversations/client#AttachmentsPicker',
			messageFooter: '@10x-media/conversations/client#AttachmentsList',
		},
	}
}

export {
	ATTACHMENTS,
	type AttachmentsClientData,
	type AttachmentView,
	attachmentsOf,
	formatSize,
	isImage,
} from './shared'
