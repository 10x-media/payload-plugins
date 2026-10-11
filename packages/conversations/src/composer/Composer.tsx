'use client'

import {
	$getSelection,
	$isRangeSelection,
	COMMAND_PRIORITY_HIGH,
	KEY_ENTER_COMMAND,
	type LexicalEditor,
	PASTE_COMMAND,
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
	type DragEvent,
	type MutableRefObject,
	type ReactNode,
	useCallback,
	useEffect,
	useMemo,
	useRef,
	useState,
} from 'react'

import {
	type ComposerClassNames,
	ComposerClassProvider,
	type ComposerPart,
	composerClass,
} from './classes'
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
	/** Inside the box, between the text and the bottom row: e.g. picked files. */
	below?: ReactNode
	className?: string
	/**
	 * Classes for the composer's parts (toolbar, menus, link field, text), e.g.
	 * a website's Tailwind classes. Added to the defaults, or alone with
	 * `unstyled`.
	 */
	classNames?: ComposerClassNames
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
	/**
	 * Files dropped on the composer or pasted into it. Absent, the composer
	 * takes neither (a pasted image does nothing). While files are dragged over
	 * it, the root has `data-dragging`.
	 */
	onFiles?: (files: File[]) => void
	onSubmit: () => void
	placeholder?: string
	submitOn?: 'enter' | 'mod+enter'
	/** Translates keys features use in their labels. Default: returns the key. */
	t?: ComposerTranslate
	toolbar?: ComposerToolbar
	/**
	 * Drop the default classes (the admin's look, on Payload's variables) and
	 * style every part through `classNames` alone.
	 */
	unstyled?: boolean
}

const identity: ComposerTranslate = (key) => key

/** Lexical's theme: the classes of text inside the editor. */
const themeFor = (styling: { classNames?: ComposerClassNames; unstyled?: boolean }) => {
	const cls = (part: ComposerPart) => composerClass(styling, part)
	return {
		link: cls('link'),
		list: {
			listitem: cls('listItem'),
			nested: { listitem: cls('nestedListItem') },
			ol: cls('ol'),
			ul: cls('ul'),
		},
		paragraph: cls('paragraph'),
		text: { bold: cls('bold'), italic: cls('italic') },
	}
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
const FocusOnBoxClick = ({ children, className }: { children: ReactNode; className?: string }) => {
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

const hasFiles = (event: DragEvent) => event.dataTransfer.types.includes('Files')

/** Drag and drop of files onto the composer's box, and whether some are over it now. */
const useFileDrop = (onFiles?: (files: File[]) => void) => {
	const [dragging, setDragging] = useState(false)
	// Entering a child fires enter on it before leave on its parent; count the depth.
	const depth = useRef(0)
	if (!onFiles) return { dragging: false, handlers: {} }
	return {
		dragging,
		handlers: {
			onDragEnter: (event: DragEvent) => {
				if (!hasFiles(event)) return
				depth.current += 1
				setDragging(true)
			},
			onDragLeave: (event: DragEvent) => {
				if (!hasFiles(event)) return
				depth.current = Math.max(0, depth.current - 1)
				if (depth.current === 0) setDragging(false)
			},
			onDragOver: (event: DragEvent) => {
				if (hasFiles(event)) event.preventDefault()
			},
			onDrop: (event: DragEvent) => {
				if (!hasFiles(event)) return
				event.preventDefault()
				depth.current = 0
				setDragging(false)
				onFiles([...event.dataTransfer.files])
			},
		},
	}
}

/** Files on the clipboard go to `onFiles` instead of into the text. */
const PasteFiles = ({ onFiles }: { onFiles: (files: File[]) => void }) => {
	const [editor] = useLexicalComposerContext()
	const latest = useRef(onFiles)
	latest.current = onFiles
	useEffect(
		() =>
			editor.registerCommand(
				PASTE_COMMAND,
				(event) => {
					const files =
						'clipboardData' in event ? [...(event.clipboardData?.files ?? [])] : ([] as File[])
					if (files.length === 0) return false
					event.preventDefault()
					latest.current(files)
					return true
				},
				COMMAND_PRIORITY_HIGH
			),
		[editor]
	)
	return null
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
	below,
	className,
	classNames,
	editorRef,
	features,
	footer,
	initialBody,
	labels,
	mentions,
	onChange,
	onFiles,
	onSubmit,
	placeholder = '',
	submitOn = 'enter',
	t = identity,
	toolbar = 'bottom',
	unstyled,
}: ComposerProps) => {
	const drop = useFileDrop(onFiles)
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
		theme: themeFor({ classNames, unstyled }),
	}))
	const markdown = useMemo(() => features.flatMap((feature) => feature.markdown ?? []), [features])
	const latestSubmit = useRef(onSubmit)
	latestSubmit.current = onSubmit
	const submit = useCallback(() => latestSubmit.current(), [])

	return (
		<ComposerRuntimeContext.Provider value={runtime}>
			<ComposerClassProvider classNames={classNames} unstyled={unstyled}>
				<LexicalComposer initialConfig={initialConfig}>
					<div
						className={[
							composerClass({ classNames, unstyled }, 'root'),
							unstyled ? null : `conversations-editor--toolbar-${placement}`,
							className,
						]
							.filter(Boolean)
							.join(' ')}
						data-dragging={drop.dragging ? '' : undefined}
						data-toolbar={placement}
						{...drop.handlers}
					>
						{placement === 'top' ? <Toolbar items={toolbarItems} /> : null}
						<FocusOnBoxClick className={composerClass({ classNames, unstyled }, 'input')}>
							<RichTextPlugin
								contentEditable={
									<ContentEditable
										aria-placeholder={placeholder}
										className={composerClass({ classNames, unstyled }, 'content')}
										placeholder={
											<div className={composerClass({ classNames, unstyled }, 'placeholder')}>
												{placeholder}
											</div>
										}
									/>
								}
								ErrorBoundary={LexicalErrorBoundary}
							/>
						</FocusOnBoxClick>
						{below}
						<FocusOnBoxClick className={composerClass({ classNames, unstyled }, 'footer')}>
							{placement === 'bottom' ? <Toolbar items={toolbarItems} /> : <span />}
							<div className={composerClass({ classNames, unstyled }, 'footerEnd')}>{footer}</div>
						</FocusOnBoxClick>
					</div>
					<HistoryPlugin />
					{markdown.length > 0 ? <MarkdownShortcutPlugin transformers={markdown} /> : null}
					<SlashMenu />
					{features.map((feature) =>
						feature.Plugin ? <feature.Plugin key={feature.key} /> : null
					)}
					<SubmitOnEnter isOverlayOpen={isOverlayOpen} onSubmit={submit} submitOn={submitOn} />
					{autoFocus ? <AutoFocus /> : null}
					{editorRef ? <EditorRefPlugin editorRef={editorRef} /> : null}
					{onChange ? <ChangeListener onChange={onChange} /> : null}
					{onFiles ? <PasteFiles onFiles={onFiles} /> : null}
				</LexicalComposer>
			</ComposerClassProvider>
		</ComposerRuntimeContext.Provider>
	)
}
