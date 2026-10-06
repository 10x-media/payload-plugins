'use client'

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react'

import { useComposerAddon } from '../react/composerAddons'
import { useExtension } from '../react/hooks'
import { useChatStore } from '../react/provider'
import type { ConversationsStore } from '../react/store'
import type { ConversationMessage } from '../types'
import {
	ATTACHMENT_CHANNEL_HEADER,
	ATTACHMENT_HEADER,
	ATTACHMENT_KEY_HEADER,
	ATTACHMENTS,
	type AttachmentsClientData,
	type AttachmentView,
	acceptsType,
	attachmentsOf,
} from './shared'

/** A file picked in a composer, not sent yet. */
export type PickedFile = {
	file: File
	/** Local, for keys and `remove`. */
	id: string
	/** An object URL for an image's preview, else null. */
	preview: null | string
}

/** A file of a message on its way: uploading, or failed to. */
export type UploadState = {
	error: null | string
	filename: string
	status: 'failed' | 'uploading'
}

/** Why a picked file was turned away before any upload. */
export type RejectedFile = { filename: string; reason: 'tooMany' | 'type' }

type Uploads = {
	get: (clientId: string) => UploadState[] | undefined
	set: (clientId: string, states: UploadState[]) => void
	subscribe: (listener: () => void) => () => void
	version: () => number
}

const createUploads = (): Uploads => {
	const entries = new Map<string, UploadState[]>()
	const listeners = new Set<() => void>()
	let version = 0
	return {
		get: (clientId) => entries.get(clientId),
		set: (clientId, states) => {
			if (states.length === 0) entries.delete(clientId)
			else entries.set(clientId, states)
			version += 1
			for (const listener of listeners) listener()
		},
		subscribe: (listener) => {
			listeners.add(listener)
			return () => listeners.delete(listener)
		},
		version: () => version,
	}
}

/** Upload states by send (`clientId`), per provider: a composer writes them, messages read them. */
const uploadsByStore = new WeakMap<ConversationsStore, Uploads>()

const uploadsOf = (store: ConversationsStore): Uploads => {
	let uploads = uploadsByStore.get(store)
	if (!uploads) {
		uploads = createUploads()
		uploadsByStore.set(store, uploads)
	}
	return uploads
}

let localId = 0

const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error))

export type UseAttachmentsComposerResult = {
	/** For a file input: the collection's MIME types, or undefined for any. */
	accept: string | undefined
	/** Pick files (a file input, a drop). Over the limit or of the wrong type, they are `rejected`. */
	add: (files: File[]) => void
	/** The extension is on for this instance. */
	enabled: boolean
	files: PickedFile[]
	maxFiles: number
	/** Files turned away by the last `add`; cleared by the next one. */
	rejected: RejectedFile[]
	remove: (id: string) => void
}

/**
 * Picked files of the composer around it, uploaded when the message is sent:
 * each through the collection's REST endpoint, then the send carries the ids
 * of those that made it. A failed upload does not stop the message; it shows
 * under it (`useAttachments(message).uploads`). Registers the composer addon,
 * so drops and pastes land here too.
 */
export const useAttachmentsComposer = ({
	channel,
	conversationKey,
}: {
	channel: string
	conversationKey: string
}): UseAttachmentsComposerResult => {
	const store = useChatStore()
	const settings = useExtension<AttachmentsClientData>(ATTACHMENTS)
	const [files, setFiles] = useState<PickedFile[]>([])
	const [rejected, setRejected] = useState<RejectedFile[]>([])
	const current = useRef(files)
	current.current = files
	const maxFiles = settings?.maxFiles ?? 0
	const mimeTypes = settings?.mimeTypes ?? []

	const add = useCallback(
		(incoming: File[]) => {
			if (!settings) return
			const turnedAway: RejectedFile[] = []
			const next = [...current.current]
			for (const file of incoming) {
				if (!acceptsType(settings.mimeTypes, file.type)) {
					turnedAway.push({ filename: file.name, reason: 'type' })
				} else if (next.length >= settings.maxFiles) {
					turnedAway.push({ filename: file.name, reason: 'tooMany' })
				} else {
					localId += 1
					next.push({
						file,
						id: `file-${localId}`,
						preview: file.type.startsWith('image/') ? URL.createObjectURL(file) : null,
					})
				}
			}
			current.current = next
			setFiles(next)
			setRejected(turnedAway)
		},
		[settings]
	)

	const remove = useCallback((id: string) => {
		const gone = current.current.find((entry) => entry.id === id)
		if (gone?.preview) URL.revokeObjectURL(gone.preview)
		current.current = current.current.filter((entry) => entry.id !== id)
		setFiles(current.current)
	}, [])

	// Object URLs of files still picked when the composer goes away.
	useEffect(
		() => () => {
			for (const entry of current.current) if (entry.preview) URL.revokeObjectURL(entry.preview)
		},
		[]
	)

	useComposerAddon(ATTACHMENTS, {
		onFiles: settings ? add : undefined,
		prepare: async ({ clientId }) => {
			const picked = current.current
			if (!settings || picked.length === 0) return undefined
			const uploads = uploadsOf(store)
			const states: UploadState[] = picked.map((entry) => ({
				error: null,
				filename: entry.file.name,
				status: 'uploading',
			}))
			uploads.set(clientId, states)
			// One after another: Payload picks a free filename before inserting, so two
			// concurrent uploads of `image.png` race for the same one and one fails.
			const results: Array<null | number | string> = []
			for (const [index, entry] of picked.entries()) {
				try {
					const doc = await store.api.upload<{ id: number | string }>({
						collection: settings.collection,
						file: entry.file,
						headers: {
							[ATTACHMENT_CHANNEL_HEADER]: channel,
							[ATTACHMENT_HEADER]: store.instance,
							[ATTACHMENT_KEY_HEADER]: conversationKey,
						},
					})
					results.push(doc.id)
				} catch (error) {
					states[index] = { error: errorText(error), filename: entry.file.name, status: 'failed' }
					results.push(null)
				}
			}
			// Only the failures stay: they show under the sent message.
			uploads.set(
				clientId,
				states.filter((state) => state.status === 'failed')
			)
			return results.filter((id) => id !== null)
		},
		reset: () => {
			for (const entry of current.current) if (entry.preview) URL.revokeObjectURL(entry.preview)
			current.current = []
			setFiles([])
			setRejected([])
		},
	})

	return {
		accept: mimeTypes.length > 0 ? mimeTypes.join(',') : undefined,
		add,
		enabled: Boolean(settings),
		files,
		maxFiles,
		rejected,
		remove,
	}
}

export type UseAttachmentsResult = {
	/** The message's files, from the server. */
	files: AttachmentView[]
	/** This tab's uploads for it: in flight while it sends, then the ones that failed. */
	uploads: UploadState[]
}

/** A message's files, and in the sending tab the state of its uploads. */
export const useAttachments = (message: ConversationMessage): UseAttachmentsResult => {
	const store = useChatStore()
	const uploads = uploadsOf(store)
	useSyncExternalStore(uploads.subscribe, uploads.version, uploads.version)
	return {
		files: attachmentsOf(message),
		uploads: (message.clientId && uploads.get(message.clientId)) || [],
	}
}
