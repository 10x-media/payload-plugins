'use client'

import {
	$createParagraphNode,
	$getRoot,
	type LexicalEditor,
} from '@payloadcms/richtext-lexical/lexical'
import { type ReactNode, useCallback, useMemo, useRef, useState } from 'react'

import { Composer, type ComposerToolbar } from '../composer/Composer'
import { defaultComposerFeatures } from '../composer/features'
import { EyeIcon, LockIcon } from '../composer/icons'
import { hasContent, toStoredJSON } from '../composer/json'
import type { ComposerFeature, ComposerLabels, ComposerTranslate } from '../composer/types'
import { resolveLabel, useSend } from '../react/hooks'
import { useChatStore } from '../react/provider'
import { keys } from '../translations/keys'
import { useTranslation } from '../translations/useTranslation'
import type { LocalizedLabel } from '../types'
import { ChatSlot } from './components'
import './conversations.css'

export type ChatComposerProps = {
	/** Slot above the editor, under the channel cue. */
	above?: ReactNode
	/** Extra buttons next to Send. */
	actions?: ReactNode
	/** Focus the editor on mount. Default: when editing. */
	autoFocus?: boolean
	channel: string
	/** The conversation key (`collection:<slug>:<id>`, ...). */
	conversationKey: string
	/** Shown above the editor: which channel this goes to, and who reads it. */
	cue?: { label: LocalizedLabel; tone: 'neutral' | 'warning' } | null
	/** A link at the end of the cue line, e.g. "Switch to Shared". */
	cueAction?: { label: ReactNode; onClick: () => void } | null
	/** Why the user cannot post; replaces the editor. */
	disabledReason?: ReactNode
	/** The editor's features. Default: bold, italic, link, lists, mention. */
	features?: (args: { defaultFeatures: ComposerFeature[] }) => ComposerFeature[]
	/** Editing: the body to start from. */
	initialBody?: unknown
	instance: string
	onCancel?: () => void
	/** Editing: called with the new body instead of sending. */
	onSave?: (body: unknown) => Promise<unknown>
	parent?: null | string
	placeholder?: string
	/** Label of the send button. */
	submitLabel?: string
	submitOn?: 'enter' | 'mod+enter'
	/**
	 * Where the formatting buttons sit (default `bottom`; `none` leaves `/` and
	 * markdown), or `{ placement, items }` to keep and order group or item keys.
	 */
	toolbar?: ComposerToolbar
}

const clear = (editor: LexicalEditor) => {
	editor.update(() => {
		const root = $getRoot()
		root.clear()
		root.append($createParagraphNode())
		root.selectEnd()
	})
}

/**
 * The message editor for the admin: the plugin's own Lexical composer
 * (formatting, `/` commands, `@` mentions, links) under a channel cue, with
 * Send in the same box. Enter sends, Shift+Enter breaks the line. A failed
 * send keeps the text and offers Retry under the same `clientId`.
 */
export const ChatComposer = ({
	above,
	actions,
	autoFocus,
	channel,
	conversationKey,
	cue,
	cueAction,
	disabledReason,
	features,
	initialBody,
	instance,
	onCancel,
	onSave,
	parent = null,
	placeholder,
	submitLabel,
	submitOn = 'enter',
	toolbar = 'bottom',
}: ChatComposerProps) => {
	const { i18n, t } = useTranslation()
	const { retry, send } = useSend({ channel, key: conversationKey, parent })
	const store = useChatStore()
	// Editing starts from the message; a new message from what was left unsent here.
	const draftKey = onSave ? null : `${conversationKey}|${channel}|${parent ?? ''}`
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
	// Features are resolved once: the editor registers its nodes on mount.
	const [resolvedFeatures] = useState(() =>
		features ? features({ defaultFeatures: defaultComposerFeatures() }) : defaultComposerFeatures()
	)

	const labels = useMemo<ComposerLabels>(
		() => ({
			bold: t(keys.bold),
			bulletList: t(keys.bulletList),
			groupInsert: t(keys.groupInsert),
			groupLists: t(keys.groupLists),
			italic: t(keys.italic),
			link: t(keys.link),
			linkApply: t(keys.linkApply),
			linkEdit: t(keys.linkEdit),
			linkInvalid: t(keys.linkInvalid),
			linkPlaceholder: t(keys.linkPlaceholder),
			linkRemove: t(keys.linkRemove),
			mention: t(keys.mention),
			mentionNoResults: t(keys.mentionNoResults),
			more: t(keys.more),
			numberedList: t(keys.numberedList),
		}),
		[t]
	)
	// Features may label items with their own translation keys.
	const translate = useMemo<ComposerTranslate>(
		() => (key, vars) => (t as (key: string, vars?: Record<string, unknown>) => string)(key, vars),
		[t]
	)

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

	const cueLabel = cue ? resolveLabel(cue.label, i18n.language) : null
	const tone = cue?.tone ?? 'neutral'

	return (
		<div
			className={`conversations-composer${tone === 'warning' && cue ? ' conversations-composer--warning' : ''}${failed ? ' conversations-composer--failed' : ''}`}
		>
			{failed ? (
				<div className="conversations-composer__banner conversations-composer__banner--error">
					<span>{t(keys.couldNotSend)}</span>
					<button className="conversations-button" onClick={() => void submit()} type="button">
						{t(keys.retry)}
					</button>
				</div>
			) : cueLabel ? (
				<div className={`conversations-composer__banner conversations-composer__banner--${tone}`}>
					<span className="conversations-composer__cue-icon">
						{tone === 'warning' ? <EyeIcon /> : <LockIcon />}
					</span>
					<span className="conversations-composer__cue-label">{cueLabel}</span>
					{cueAction ? (
						<button
							className="conversations-composer__cue-action"
							onClick={cueAction.onClick}
							type="button"
						>
							{cueAction.label}
						</button>
					) : null}
				</div>
			) : null}
			{above}
			{onSave ? null : (
				<ChatSlot
					channel={channel}
					conversationKey={conversationKey}
					instance={instance}
					name="composerAbove"
				/>
			)}
			{disabledReason ? (
				<div className="conversations-composer__disabled">{disabledReason}</div>
			) : (
				<Composer
					autoFocus={autoFocus ?? Boolean(onSave)}
					editorRef={editorRef}
					features={resolvedFeatures}
					footer={
						<>
							<span className="conversations-composer__hint">
								{failed
									? t(keys.textKept)
									: t(submitOn === 'enter' ? keys.enterToSend : keys.modEnterToSend)}
							</span>
							{onCancel ? (
								<button className="conversations-button" onClick={onCancel} type="button">
									{t(keys.cancel)}
								</button>
							) : null}
							{actions}
							<button
								className="conversations-button conversations-button--primary"
								disabled={busy}
								onClick={() => void submit()}
								type="button"
							>
								{submitLabel ?? t(onSave ? keys.save : keys.send)}
							</button>
						</>
					}
					initialBody={startBody}
					labels={labels}
					mentions={{ channel, conversationKey }}
					onChange={draftKey ? keepDraft : undefined}
					onSubmit={() => void submit()}
					placeholder={placeholder ?? t(keys.composerPlaceholder)}
					submitOn={submitOn}
					t={translate}
					toolbar={toolbar}
				/>
			)}
		</div>
	)
}
