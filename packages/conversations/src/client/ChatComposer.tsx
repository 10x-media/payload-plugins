'use client'

import { Button } from '@payloadcms/ui'
import { type ReactNode, useMemo, useState } from 'react'

import { Composer, type ComposerToolbar } from '../composer/Composer'
import { defaultComposerFeatures } from '../composer/features'
import { GlobeIcon, LockIcon } from '../composer/icons'
import type { ComposerFeature, ComposerLabels, ComposerTranslate } from '../composer/types'
import { resolveLabel } from '../react/hooks'
import { useComposer } from '../react/useComposer'
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
	const composer = useComposer({
		channel,
		initialBody,
		key: conversationKey,
		onSave,
		parent,
	})
	const { busy, failed, submit } = composer
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

	const cueLabel = cue ? resolveLabel(cue.label, i18n.language) : null
	const tone = cue?.tone ?? 'neutral'

	return (
		<div
			className={`conversations-composer${tone === 'warning' && cue ? ' conversations-composer--warning' : ''}${failed ? ' conversations-composer--failed' : ''}`}
		>
			{failed ? (
				<div className="conversations-composer__banner conversations-composer__banner--error">
					<span>{t(keys.couldNotSend)}</span>
					<Button buttonStyle="secondary" margin={false} onClick={() => void submit()} size="small">
						{t(keys.retry)}
					</Button>
				</div>
			) : cueLabel ? (
				<div className={`conversations-composer__banner conversations-composer__banner--${tone}`}>
					<span className="conversations-composer__cue-icon">
						{tone === 'warning' ? <GlobeIcon /> : <LockIcon />}
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
					editorRef={composer.editorRef}
					features={resolvedFeatures}
					footer={
						<>
							<span className="conversations-composer__hint">
								{failed
									? t(keys.textKept)
									: t(submitOn === 'enter' ? keys.enterToSend : keys.modEnterToSend)}
							</span>
							{onCancel ? (
								<Button buttonStyle="secondary" margin={false} onClick={onCancel} size="small">
									{t(keys.cancel)}
								</Button>
							) : null}
							{actions}
							<Button
								buttonStyle="primary"
								className="conversations-composer__send"
								disabled={busy}
								margin={false}
								onClick={() => void submit()}
								size="small"
							>
								{submitLabel ?? t(onSave ? keys.save : keys.send)}
							</Button>
						</>
					}
					initialBody={composer.initialBody}
					labels={labels}
					mentions={{ channel, conversationKey }}
					onChange={composer.onChange}
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
