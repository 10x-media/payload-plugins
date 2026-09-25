'use client'

import {
	$getSelection,
	$isRangeSelection,
	COMMAND_PRIORITY_HIGH,
	KEY_ENTER_COMMAND,
	type LexicalEditor,
} from '@payloadcms/richtext-lexical/lexical'
import { $isListItemNode } from '@payloadcms/richtext-lexical/lexical/list'
import { LexicalComposer } from '@payloadcms/richtext-lexical/lexical/react/LexicalComposer'
import { useLexicalComposerContext } from '@payloadcms/richtext-lexical/lexical/react/LexicalComposerContext'
import { ContentEditable } from '@payloadcms/richtext-lexical/lexical/react/LexicalContentEditable'
import { EditorRefPlugin } from '@payloadcms/richtext-lexical/lexical/react/LexicalEditorRefPlugin'
import { LexicalErrorBoundary } from '@payloadcms/richtext-lexical/lexical/react/LexicalErrorBoundary'
import { HistoryPlugin } from '@payloadcms/richtext-lexical/lexical/react/LexicalHistoryPlugin'
import { MarkdownShortcutPlugin } from '@payloadcms/richtext-lexical/lexical/react/LexicalMarkdownShortcutPlugin'
import { RichTextPlugin } from '@payloadcms/richtext-lexical/lexical/react/LexicalRichTextPlugin'
import { $findMatchingParent } from '@payloadcms/richtext-lexical/lexical/utils'
import {
	type MutableRefObject,
	type ReactNode,
	useCallback,
	useEffect,
	useMemo,
	useRef,
	useState,
} from 'react'

import { toEditorJSON } from './json'
import { SlashMenu } from './plugins/SlashMenu'
import { type ComposerRuntime, ComposerRuntimeContext } from './runtime'
import { Toolbar } from './Toolbar'
import type { ComposerFeature, ComposerLabels, ComposerTranslate } from './types'
import './composer.css'

/**
 * Where the formatting buttons sit, and optionally which: `items` keeps and
 * orders group or item keys (`['bold', 'italic', 'insert']`). With `none`,
 * `/` and markdown shortcuts still work.
 */
export type ComposerToolbar =
	| 'bottom'
	| 'none'
	| 'top'
	| { items?: string[]; placement: 'bottom' | 'top' }

export type ComposerProps = {
	/** Focus the editor, caret at the end, when it mounts. */
	autoFocus?: boolean
	className?: string
	/** Receives the Lexical editor, for reading and clearing its state. */
	editorRef?: MutableRefObject<LexicalEditor | null>
	features: ComposerFeature[]
	/** The right side of the bottom row: hint, buttons. */
	footer?: ReactNode
	/** A stored body to start from (editing, a draft). Read once, on mount. */
	initialBody?: unknown
	labels: ComposerLabels
	/** Where `@` searches; null or absent turns mentions off. */
	mentions?: { channel: string; conversationKey: string } | null
	/** Every change of the editor's content, e.g. to keep a draft. */
	onChange?: (editor: LexicalEditor) => void
	onSubmit: () => void
	placeholder?: string
	submitOn?: 'enter' | 'mod+enter'
	/** Translates keys features use in their labels. Default: returns the key. */
	t?: ComposerTranslate
	toolbar?: ComposerToolbar
}

const identity: ComposerTranslate = (key) => key

const theme = {
	link: 'conversations-editor__link',
	list: {
		listitem: 'conversations-editor__listitem',
		nested: { listitem: 'conversations-editor__listitem--nested' },
		ol: 'conversations-editor__ol',
		ul: 'conversations-editor__ul',
	},
	paragraph: 'conversations-editor__paragraph',
	text: {
		bold: 'conversations-editor__bold',
		italic: 'conversations-editor__italic',
	},
}

/**
 * Enter sends, Shift+Enter breaks the line, Enter inside a list makes the
 * next item, and while a menu or the link field is open Enter belongs to it.
 * With `mod+enter` only Ctrl/Cmd+Enter sends.
 */
const SubmitOnEnter = ({
	isOverlayOpen,
	onSubmit,
	submitOn,
}: {
	isOverlayOpen: () => boolean
	onSubmit: () => void
	submitOn: 'enter' | 'mod+enter'
}) => {
	const [editor] = useLexicalComposerContext()
	useEffect(
		() =>
			editor.registerCommand<KeyboardEvent | null>(
				KEY_ENTER_COMMAND,
				(event) => {
					if (!event || isOverlayOpen() || event.shiftKey) return false
					const modifier = event.ctrlKey || event.metaKey
					if (submitOn === 'mod+enter' && !modifier) return false
					if (!modifier) {
						const selection = $getSelection()
						if (
							$isRangeSelection(selection) &&
							$findMatchingParent(selection.anchor.getNode(), $isListItemNode)
						) {
							return false
						}
					}
					event.preventDefault()
					onSubmit()
					return true
				},
				COMMAND_PRIORITY_HIGH
			),
		[editor, isOverlayOpen, onSubmit, submitOn]
	)
	return null
}

/** Calls `onChange` when the content changes; selection moves alone do not count. */
const ChangeListener = ({ onChange }: { onChange: (editor: LexicalEditor) => void }) => {
	const [editor] = useLexicalComposerContext()
	const latest = useRef(onChange)
	latest.current = onChange
	useEffect(
		() =>
			editor.registerUpdateListener(({ dirtyElements, dirtyLeaves }) => {
				if (dirtyElements.size > 0 || dirtyLeaves.size > 0) latest.current(editor)
			}),
		[editor]
	)
	return null
}

const AutoFocus = () => {
	const [editor] = useLexicalComposerContext()
	useEffect(() => {
		editor.focus(undefined, { defaultSelection: 'rootEnd' })
	}, [editor])
	return null
}

/** Clicking the box around the text puts the caret in it, as a text field would. */
const FocusOnBoxClick = ({ children, className }: { children: ReactNode; className: string }) => {
	const [editor] = useLexicalComposerContext()
	return (
		// biome-ignore lint/a11y/noStaticElementInteractions: a convenience for the mouse; the editor itself is focusable.
		// biome-ignore lint/a11y/useKeyWithClickEvents: as above.
		<div
			className={className}
			onClick={(event) => {
				if (event.target === event.currentTarget) editor.focus()
			}}
		>
			{children}
		</div>
	)
}

/**
 * The message editor: Lexical with the composer's own features, toolbar,
 * `/` commands, `@` mentions and link field. Headless of Payload's admin UI:
 * it takes its strings as `labels`, so a website can reuse it with its own
 * styles. The editor's JSON is the stored message shape except for links;
 * read it through `toStoredJSON`.
 */
export const Composer = ({
	autoFocus = false,
	className,
	editorRef,
	features,
	footer,
	initialBody,
	labels,
	mentions,
	onChange,
	onSubmit,
	placeholder = '',
	submitOn = 'enter',
	t = identity,
	toolbar = 'bottom',
}: ComposerProps) => {
	const placement = typeof toolbar === 'string' ? toolbar : toolbar.placement
	const toolbarItems = typeof toolbar === 'string' ? undefined : toolbar.items
	const overlays = useRef(new Set<string>())
	const setOverlay = useCallback((name: string, open: boolean) => {
		if (open) overlays.current.add(name)
		else overlays.current.delete(name)
	}, [])
	const isOverlayOpen = useCallback(() => overlays.current.size > 0, [])
	const mentionChannel = mentions?.channel
	const mentionKey = mentions?.conversationKey
	const runtime = useMemo<ComposerRuntime>(
		() => ({
			features,
			labels,
			mentions:
				mentionChannel && mentionKey
					? { channel: mentionChannel, conversationKey: mentionKey }
					: null,
			setOverlay,
			t,
		}),
		[features, labels, mentionChannel, mentionKey, setOverlay, t]
	)
	// Read once: LexicalComposer ignores later changes to its initial config.
	const [initialConfig] = useState(() => ({
		editorState: initialBody ? JSON.stringify(toEditorJSON(initialBody)) : undefined,
		namespace: 'conversations-composer',
		nodes: [...new Set(features.flatMap((feature) => feature.nodes ?? []))],
		onError: (error: Error) => {
			console.error('[@10x-media/conversations] composer', error)
		},
		theme,
	}))
	const markdown = useMemo(() => features.flatMap((feature) => feature.markdown ?? []), [features])
	const latestSubmit = useRef(onSubmit)
	latestSubmit.current = onSubmit
	const submit = useCallback(() => latestSubmit.current(), [])

	return (
		<ComposerRuntimeContext.Provider value={runtime}>
			<LexicalComposer initialConfig={initialConfig}>
				<div
					className={`conversations-editor conversations-editor--toolbar-${placement}${className ? ` ${className}` : ''}`}
				>
					{placement === 'top' ? <Toolbar items={toolbarItems} /> : null}
					<FocusOnBoxClick className="conversations-editor__input">
						<RichTextPlugin
							contentEditable={
								<ContentEditable
									aria-placeholder={placeholder}
									className="conversations-editor__content"
									placeholder={
										<div className="conversations-editor__placeholder">{placeholder}</div>
									}
								/>
							}
							ErrorBoundary={LexicalErrorBoundary}
						/>
					</FocusOnBoxClick>
					<FocusOnBoxClick className="conversations-editor__footer">
						{placement === 'bottom' ? <Toolbar items={toolbarItems} /> : <span />}
						<div className="conversations-editor__end">{footer}</div>
					</FocusOnBoxClick>
				</div>
				<HistoryPlugin />
				{markdown.length > 0 ? <MarkdownShortcutPlugin transformers={markdown} /> : null}
				<SlashMenu />
				{features.map((feature) => (feature.Plugin ? <feature.Plugin key={feature.key} /> : null))}
				<SubmitOnEnter isOverlayOpen={isOverlayOpen} onSubmit={submit} submitOn={submitOn} />
				{autoFocus ? <AutoFocus /> : null}
				{editorRef ? <EditorRefPlugin editorRef={editorRef} /> : null}
				{onChange ? <ChangeListener onChange={onChange} /> : null}
			</LexicalComposer>
		</ComposerRuntimeContext.Provider>
	)
}
