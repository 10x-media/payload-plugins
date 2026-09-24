'use client'

import { Form, useForm, useServerFunctions } from '@payloadcms/ui'
import type { FormState } from 'payload'
import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { resolveLabel, useSend } from '../react/hooks'
import { keys } from '../translations/keys'
import { useTranslation } from '../translations/useTranslation'
import type { LocalizedLabel } from '../types'
import { ChatSlot } from './components'
import { ComposerContext, type ComposerContextValue } from './composerContext'
import './conversations.css'

export type ChatComposerProps = {
	/** Slot above the editor, under the channel cue. */
	above?: ReactNode
	/** Extra buttons next to Send. */
	actions?: ReactNode
	/** Focus the editor on mount. Default: when editing. */
	autoFocus?: boolean
	channel: string
	/** Shown above the editor: which channel this goes to, and who reads it. */
	cue?: { label: LocalizedLabel; tone: 'neutral' | 'warning' } | null
	/** Why the user cannot post; replaces the editor. */
	disabledReason?: ReactNode
	/** Editing: the body to start from. */
	initialBody?: unknown
	/** The conversation key (`collection:<slug>:<id>`, ...). */
	conversationKey: string
	instance: string
	/** Editing: called with the new body instead of sending. */
	onSave?: (body: unknown) => Promise<unknown>
	onCancel?: () => void
	parent?: null | string
	placeholder?: string
	/** Label of the send button. */
	submitLabel?: string
	submitOn?: 'enter' | 'mod+enter'
}

const docPermissions = {
	create: true,
	fields: true,
	read: true,
	readVersions: false,
	update: true,
} as const

/** Whether a Lexical body holds anything worth sending. */
const hasContent = (body: unknown): boolean => {
	const walk = (node: unknown): boolean => {
		if (!node || typeof node !== 'object') return false
		const record = node as { children?: unknown[]; text?: unknown; type?: unknown }
		if (typeof record.text === 'string' && record.text.trim().length > 0) return true
		if (record.type === 'conversationsMention') return true
		return Array.isArray(record.children) && record.children.some(walk)
	}
	return walk((body as { root?: unknown } | null)?.root)
}

/** Lives inside the plugin's `<Form>`, so it can read the body the editor wrote. */
const ComposerInner = ({
	actions,
	busy,
	field,
	onSubmit,
	registerRead,
	submitLabel,
}: {
	actions?: ReactNode
	busy: boolean
	field: ReactNode
	onSubmit: () => void
	registerRead: (read: () => unknown) => void
	submitLabel: string
}) => {
	const { getData } = useForm()
	useEffect(() => registerRead(() => getData().body), [getData, registerRead])
	return (
		<>
			<div className="conversations-composer__editor">{field}</div>
			<div className="conversations-composer__actions">
				{actions}
				<button
					className="conversations-button conversations-button--primary"
					disabled={busy}
					onClick={onSubmit}
					type="button"
				>
					{submitLabel}
				</button>
			</div>
		</>
	)
}

/**
 * The message editor: Payload's own rich text field with the instance
 * editor's features, in a form the plugin owns (its state comes from
 * `getFormState`), so toolbar, links, lists and mentions behave as they do in
 * any Payload document. Enter sends, Shift+Enter breaks the line. A failed
 * send keeps the text and offers Retry under the same `clientId`.
 */
export const ChatComposer = ({
	above,
	actions,
	autoFocus,
	channel,
	cue,
	disabledReason,
	initialBody,
	instance,
	conversationKey,
	onCancel,
	onSave,
	parent = null,
	placeholder,
	submitLabel,
	submitOn = 'enter',
}: ChatComposerProps) => {
	const { i18n, t } = useTranslation()
	const { getFormState } = useServerFunctions()
	const { retry, send } = useSend({ channel, key: conversationKey, parent })
	const [state, setState] = useState<FormState | null>(null)
	const [formKey, setFormKey] = useState(0)
	const [busy, setBusy] = useState(false)
	const [failed, setFailed] = useState<null | string>(null)
	const readBody = useRef<() => unknown>(() => undefined)
	const editorRef = useRef<{ getEditorState: () => { toJSON: () => unknown } } | null>(null)
	const root = useRef<HTMLDivElement>(null)
	const menuOpen = useRef(false)
	const messagesSlug = `${instance}-messages`

	useEffect(() => {
		let cancelled = false
		void getFormState({
			collectionSlug: messagesSlug,
			data: initialBody ? { body: initialBody } : {},
			docPermissions: docPermissions as never,
			docPreferences: { fields: {} },
			operation: initialBody ? 'update' : 'create',
			renderAllFields: true,
			schemaPath: messagesSlug,
			select: { body: true },
			skipValidation: true,
		}).then((result) => {
			if (!cancelled && result?.state) setState(result.state)
		})
		return () => {
			cancelled = true
		}
	}, [getFormState, initialBody, messagesSlug])

	const submit = useCallback(async () => {
		if (busy) return
		if (failed) {
			setBusy(true)
			try {
				await retry(failed)
				setFailed(null)
				setFormKey((value) => value + 1)
			} catch {
				// Still failed; the banner stays.
			} finally {
				setBusy(false)
			}
			return
		}
		const body = editorRef.current?.getEditorState().toJSON() ?? readBody.current()
		if (!hasContent(body)) return
		setBusy(true)
		try {
			if (onSave) {
				await onSave(body)
			} else {
				await send({ body })
				setFormKey((value) => value + 1)
			}
		} catch (error) {
			const clientId = (error as { clientId?: string }).clientId
			setFailed(clientId ?? 'unknown')
		} finally {
			setBusy(false)
		}
	}, [busy, failed, onSave, retry, send])

	const context = useMemo<ComposerContextValue>(
		() => ({
			autoFocus: autoFocus ?? Boolean(onSave),
			channel,
			instance,
			key: conversationKey,
			menuOpen: () => menuOpen.current,
			registerEditor: (editor) => {
				editorRef.current = editor
			},
			setMenuOpen: (open) => {
				menuOpen.current = open
			},
			submit: () => void submit(),
			submitOn,
		}),
		[autoFocus, channel, conversationKey, instance, onSave, submit, submitOn]
	)

	// A fresh form after a send: put the caret back so the next message can follow.
	useEffect(() => {
		if (formKey === 0) return
		const timer = setTimeout(() => {
			root.current?.querySelector<HTMLElement>('[contenteditable="true"]')?.focus()
		}, 50)
		return () => clearTimeout(timer)
	}, [formKey])

	const registerRead = useCallback((read: () => unknown) => {
		readBody.current = read
	}, [])

	const cueLabel = cue ? resolveLabel(cue.label, i18n.language) : null
	const field = state?.body?.customComponents?.Field

	return (
		<div
			className={`conversations-composer${cue?.tone === 'warning' ? ' conversations-composer--warning' : ''}${failed ? ' conversations-composer--failed' : ''}`}
			data-placeholder={placeholder ?? t(keys.composerPlaceholder)}
			ref={root}
		>
			{failed ? (
				<div className="conversations-composer__banner conversations-composer__banner--error">
					<span>{t(keys.couldNotSend)}</span>
					<button className="conversations-button" onClick={() => void submit()} type="button">
						{t(keys.retry)}
					</button>
				</div>
			) : cueLabel ? (
				<div
					className={`conversations-composer__banner conversations-composer__banner--${cue?.tone ?? 'neutral'}`}
				>
					{cueLabel}
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
			) : state && field ? (
				<ComposerContext.Provider value={context}>
					<Form initialState={state} key={formKey} onSubmit={() => void submit()}>
						<ComposerInner
							actions={
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
								</>
							}
							busy={busy}
							field={field}
							onSubmit={() => void submit()}
							registerRead={registerRead}
							submitLabel={submitLabel ?? t(onSave ? keys.save : keys.send)}
						/>
					</Form>
				</ComposerContext.Provider>
			) : (
				<div className="conversations-composer__loading" />
			)}
		</div>
	)
}
