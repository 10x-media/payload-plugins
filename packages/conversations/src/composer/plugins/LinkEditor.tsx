'use client'

import {
	$createTextNode,
	$getNodeByKey,
	$getSelection,
	$isRangeSelection,
	$setSelection,
	type BaseSelection,
	COMMAND_PRIORITY_LOW,
	COMMAND_PRIORITY_NORMAL,
	KEY_MODIFIER_COMMAND,
} from '@payloadcms/richtext-lexical/lexical'
import {
	$createLinkNode,
	$isLinkNode,
	$toggleLink,
	type LinkAttributes,
	type LinkNode,
} from '@payloadcms/richtext-lexical/lexical/link'
import { useLexicalComposerContext } from '@payloadcms/richtext-lexical/lexical/react/LexicalComposerContext'
import { $findMatchingParent, mergeRegister } from '@payloadcms/richtext-lexical/lexical/utils'
import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

import { CheckIcon, CrossIcon, PencilIcon } from '../icons'
import { displayUrl, normalizeUrl } from '../links'
import { caretRect, useFloatingPlacement } from '../Menu'
import { OPEN_LINK_EDITOR_COMMAND, useComposerRuntime } from '../runtime'

/** Every link the composer makes opens in a new tab. */
export const LINK_ATTRIBUTES: LinkAttributes = { rel: 'noopener noreferrer', target: '_blank' }

type Editing = {
	linkKey: null | string
	rect: DOMRect | null
	selection: BaseSelection | null
	url: string
}

type Current = { key: string; rect: DOMRect | null; url: string }

const $linkAtSelection = (): LinkNode | null => {
	const selection = $getSelection()
	if (!$isRangeSelection(selection)) return null
	const node = $findMatchingParent(selection.anchor.getNode(), $isLinkNode)
	return node && $isLinkNode(node) ? node : null
}

const Floating = ({
	children,
	className,
	rect,
}: {
	children: React.ReactNode
	className: string
	rect: DOMRect | null
}) => {
	const { ref, style } = useFloatingPlacement(() => rect)
	return createPortal(
		<div className={className} ref={ref} style={style}>
			{children}
		</div>,
		document.body
	)
}

/**
 * Links without Payload's drawer: Ctrl/Cmd+K, the toolbar or `/link` open a
 * small field at the selection. With text selected it links that text, with
 * a bare caret it inserts the URL as text. A caret inside a link shows the
 * URL with Edit and Remove.
 */
export const LinkEditor = () => {
	const [editor] = useLexicalComposerContext()
	const { labels, setOverlay } = useComposerRuntime()
	const [editing, setEditing] = useState<Editing | null>(null)
	const [current, setCurrent] = useState<Current | null>(null)
	const [focused, setFocused] = useState(false)
	const [value, setValue] = useState('')
	const [invalid, setInvalid] = useState(false)
	const box = useRef<HTMLDivElement>(null)
	const input = useRef<HTMLInputElement>(null)
	const isEditing = editing !== null

	// Focused after the editor has settled: picked from the `/` menu, the menu's
	// close hands focus back to the editor right after the field mounts.
	useEffect(() => {
		if (!isEditing) return
		const timer = setTimeout(() => input.current?.focus(), 30)
		return () => clearTimeout(timer)
	}, [isEditing])

	const open = useCallback(() => {
		editor.getEditorState().read(() => {
			const link = $linkAtSelection()
			const element = link ? editor.getElementByKey(link.getKey()) : null
			const rect =
				element?.getBoundingClientRect() ??
				caretRect() ??
				editor.getRootElement()?.getBoundingClientRect() ??
				null
			const url = link?.getURL() ?? ''
			setEditing({
				linkKey: link?.getKey() ?? null,
				rect,
				selection: $getSelection()?.clone() ?? null,
				url,
			})
			setValue(url)
			setInvalid(false)
		})
	}, [editor])

	const close = useCallback(() => {
		setEditing(null)
		editor.focus()
	}, [editor])

	// DOM focus on the editable itself: Lexical's focus commands can be taken
	// by a handler of higher priority before they reach this plugin.
	useEffect(() => {
		const onFocus = () => setFocused(true)
		const onBlur = () => setFocused(false)
		let current: HTMLElement | null = null
		const unregister = editor.registerRootListener((root, previous) => {
			previous?.removeEventListener('focus', onFocus)
			previous?.removeEventListener('blur', onBlur)
			root?.addEventListener('focus', onFocus)
			root?.addEventListener('blur', onBlur)
			current = root
			setFocused(root !== null && document.activeElement === root)
		})
		return () => {
			unregister()
			current?.removeEventListener('focus', onFocus)
			current?.removeEventListener('blur', onBlur)
		}
	}, [editor])

	useEffect(
		() =>
			mergeRegister(
				editor.registerCommand(
					OPEN_LINK_EDITOR_COMMAND,
					() => {
						open()
						return true
					},
					COMMAND_PRIORITY_LOW
				),
				editor.registerCommand<KeyboardEvent>(
					KEY_MODIFIER_COMMAND,
					(event) => {
						if (!(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== 'k') return false
						event.preventDefault()
						open()
						return true
					},
					COMMAND_PRIORITY_NORMAL
				),
				editor.registerUpdateListener(({ editorState }) => {
					editorState.read(() => {
						const link = $linkAtSelection()
						if (!link) {
							setCurrent(null)
							return
						}
						const element = editor.getElementByKey(link.getKey())
						setCurrent({
							key: link.getKey(),
							rect: element?.getBoundingClientRect() ?? null,
							url: link.getURL(),
						})
					})
				})
			),
		[editor, open]
	)

	useEffect(() => {
		setOverlay('link', editing !== null)
		return () => setOverlay('link', false)
	}, [editing, setOverlay])

	// A click anywhere else closes the field without applying it.
	useEffect(() => {
		if (!editing) return
		const onDown = (event: MouseEvent) => {
			if (box.current && !box.current.contains(event.target as Node)) setEditing(null)
		}
		document.addEventListener('mousedown', onDown)
		return () => document.removeEventListener('mousedown', onDown)
	}, [editing])

	const apply = () => {
		if (!editing) return
		const url = normalizeUrl(value)
		if (!url) {
			setInvalid(true)
			return
		}
		editor.update(() => {
			if (editing.linkKey) {
				const node = $getNodeByKey(editing.linkKey)
				if ($isLinkNode(node)) node.setURL(url)
				return
			}
			if (editing.selection) $setSelection(editing.selection.clone())
			const selection = $getSelection()
			if (!$isRangeSelection(selection)) return
			if (selection.isCollapsed()) {
				const link = $createLinkNode(url, LINK_ATTRIBUTES)
				link.append($createTextNode(displayUrl(url)))
				selection.insertNodes([link])
				const space = $createTextNode(' ')
				link.insertAfter(space)
				space.select(1, 1)
			} else {
				$toggleLink(url, LINK_ATTRIBUTES)
			}
		})
		close()
	}

	const remove = (key: string) => {
		editor.update(() => {
			const node = $getNodeByKey(key)
			if (!$isLinkNode(node)) return
			for (const child of node.getChildren()) node.insertBefore(child)
			node.remove()
		})
		setEditing(null)
		editor.focus()
	}

	if (typeof document === 'undefined') return null

	if (editing) {
		return (
			<Floating className="conversations-link-editor" rect={editing.rect}>
				<div ref={box}>
					<div className="conversations-link-editor__row">
						<input
							aria-invalid={invalid}
							className="conversations-link-editor__input"
							ref={input}
							onChange={(event) => {
								setValue(event.target.value)
								setInvalid(false)
							}}
							onKeyDown={(event) => {
								if (event.key === 'Enter') {
									event.preventDefault()
									apply()
								} else if (event.key === 'Escape') {
									event.preventDefault()
									close()
								}
							}}
							placeholder={labels.linkPlaceholder}
							type="text"
							value={value}
						/>
						<button
							className="conversations-link-editor__button"
							aria-label={labels.linkApply}
							title={labels.linkApply}
							onClick={apply}
							type="button"
						>
							<CheckIcon />
						</button>
						{editing.linkKey ? (
							<button
								className="conversations-link-editor__button"
								aria-label={labels.linkRemove}
								title={labels.linkRemove}
								onClick={() => remove(editing.linkKey as string)}
								type="button"
							>
								<CrossIcon />
							</button>
						) : null}
					</div>
					{invalid ? (
						<div className="conversations-link-editor__error">{labels.linkInvalid}</div>
					) : null}
				</div>
			</Floating>
		)
	}

	if (current && focused) {
		return (
			<Floating
				className="conversations-link-editor conversations-link-editor--preview"
				rect={current.rect}
			>
				{/* biome-ignore lint/a11y/noStaticElementInteractions: keeps the editor focused while the buttons are pressed. */}
				<div
					className="conversations-link-editor__row"
					onMouseDown={(event) => event.preventDefault()}
				>
					<a
						className="conversations-link-editor__url"
						href={current.url}
						rel="noopener noreferrer"
						target="_blank"
					>
						{displayUrl(current.url)}
					</a>
					<button
						className="conversations-link-editor__button"
						aria-label={labels.linkEdit}
						title={labels.linkEdit}
						onClick={open}
						type="button"
					>
						<PencilIcon />
					</button>
					<button
						className="conversations-link-editor__button"
						aria-label={labels.linkRemove}
						title={labels.linkRemove}
						onClick={() => remove(current.key)}
						type="button"
					>
						<CrossIcon />
					</button>
				</div>
			</Floating>
		)
	}

	return null
}
