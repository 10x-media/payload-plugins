'use client'

import {
	$createParagraphNode,
	$getRoot,
	type LexicalEditor,
} from '@payloadcms/richtext-lexical/lexical'
import { type RefObject, useCallback, useRef, useState } from 'react'

import { hasContent, toStoredJSON } from '../composer/json'
import { useSend } from './hooks'
import { useChatStore } from './provider'

const clear = (editor: LexicalEditor) => {
	editor.update(() => {
		const root = $getRoot()
		root.clear()
		root.append($createParagraphNode())
		root.selectEnd()
	})
}

export type UseComposerResult = {
	/** A send or save is under way. */
	busy: boolean
	/** Pass to the composer's `editorRef`. */
	editorRef: RefObject<LexicalEditor | null>
	/** A send failed: the text stays, and `submit` retries it under the same `clientId`. */
	failed: boolean
	/** The body the editor starts from: the edited message, or what was left unsent here. */
	initialBody: unknown
	/** Pass to the composer's `onChange`: keeps the draft (absent while editing). */
	onChange?: (editor: LexicalEditor) => void
	/** Send (or save, or retry) what is in the editor. */
	submit: () => Promise<void>
}

/**
 * The behaviour of a message editor, for any markup around `Composer`:
 * sending (optimistic, cleared on success), a failed send kept for Retry
 * under the same `clientId`, and the unsent text kept per conversation,
 * channel and thread while the provider lives. With `onSave` it edits
 * instead: no draft, the body goes to `onSave`.
 */
export const useComposer = ({
	channel,
	initialBody,
	key,
	onSave,
	parent = null,
}: {
	channel: string
	/** Editing: the body to start from. */
	initialBody?: unknown
	key: string
	/** Editing: called with the new body instead of sending. */
	onSave?: (body: unknown) => Promise<unknown>
	parent?: null | string
}): UseComposerResult => {
	const { retry, send } = useSend({ channel, key, parent })
	const store = useChatStore()
	// Editing starts from the message; a new message from what was left unsent here.
	const draftKey = onSave ? null : `${key}|${channel}|${parent ?? ''}`
	const [startBody] = useState(() =>
		initialBody !== undefined ? initialBody : draftKey ? store.drafts.get(draftKey) : undefined
	)
	const keepDraft = useCallback(
		(editor: LexicalEditor) => {
			if (!draftKey) return
			const body = toStoredJSON(editor.getEditorState().toJSON())
			if (hasContent(body)) store.drafts.set(draftKey, body)
			else store.drafts.delete(draftKey)
		},
		[draftKey, store]
	)
	const [busy, setBusy] = useState(false)
	const [failed, setFailed] = useState<null | string>(null)
	const editorRef = useRef<LexicalEditor | null>(null)

	const submit = useCallback(async () => {
		if (busy) return
		const editor = editorRef.current
		if (failed) {
			setBusy(true)
			try {
				await retry(failed)
				setFailed(null)
				if (editor) clear(editor)
			} catch {
				// Still failed; the banner stays.
			} finally {
				setBusy(false)
			}
			return
		}
		if (!editor) return
		const body = toStoredJSON(editor.getEditorState().toJSON())
		if (!hasContent(body)) return
		setBusy(true)
		try {
			if (onSave) {
				await onSave(body)
			} else {
				await send({ body })
				clear(editor)
				editor.focus()
			}
		} catch (error) {
			const clientId = (error as { clientId?: string }).clientId
			setFailed(clientId ?? 'unknown')
		} finally {
			setBusy(false)
		}
	}, [busy, failed, onSave, retry, send])

	return {
		busy,
		editorRef,
		failed: failed !== null,
		initialBody: startBody,
		onChange: draftKey ? keepDraft : undefined,
		submit,
	}
}
