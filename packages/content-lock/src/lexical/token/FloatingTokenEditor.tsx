'use client'

import type { PluginComponentWithAnchor } from '@payloadcms/richtext-lexical'
import { setFloatingElemPositionForLinkEditor } from '@payloadcms/richtext-lexical/client'
import {
	$getNodeByKey,
	$getSelection,
	$isNodeSelection,
	COMMAND_PRIORITY_LOW,
	SELECTION_CHANGE_COMMAND,
} from '@payloadcms/richtext-lexical/lexical'
import { useLexicalComposerContext } from '@payloadcms/richtext-lexical/lexical/react/LexicalComposerContext'
import { useLexicalEditable } from '@payloadcms/richtext-lexical/lexical/react/useLexicalEditable'
import { mergeRegister } from '@payloadcms/richtext-lexical/lexical/utils'
import { ChevronIcon, CloseMenuIcon, DatePicker, Popup, PopupList } from '@payloadcms/ui'
import { type ReactNode, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

import { keys } from '../../translations/keys'
import { useTranslation } from '../../translations/useTranslation'
import { tokenIcons } from './icons'
import { $isContentLockTokenNode } from './node'
import type { ContentLockTokenClientProps } from './server'
import { DATE_FORMATS, dateFormatLabel, type TokenData, tokenKindLabel } from './types'
import { useTokenPreview } from './useTokenPreview'

const baseClass = 'content-lock-token-editor'

/**
 * Round the panel's translate to whole pixels. The positioning helper leaves
 * fractions, and a text layer at a fractional offset renders blurred.
 */
const snapToPixels = (element: HTMLElement): void => {
	const match = /translate\((-?[\d.]+)px,\s*(-?[\d.]+)px\)/.exec(element.style.transform)
	if (match) {
		element.style.transform = `translate(${Math.round(Number(match[1]))}px, ${Math.round(Number(match[2]))}px)`
	}
}

/** Keeps a mousedown on the panel from moving the editor's selection off the token. */
const preventDefault = (event: { preventDefault: () => void }): void => event.preventDefault()

/** A compact dropdown: the current choice as the trigger, the options as a list. */
const Dropdown = ({
	label,
	children,
}: {
	label: string
	children: (close: () => void) => ReactNode
}) => (
	<Popup
		button={
			<span className={`${baseClass}__trigger`}>
				{label}
				<ChevronIcon direction="down" />
			</span>
		}
		buttonType="custom"
		className={`${baseClass}__dropdown`}
		horizontalAlign="left"
		render={({ close }) => <PopupList.ButtonGroup>{children(close)}</PopupList.ButtonGroup>}
		size="fit-content"
		verticalAlign="bottom"
	/>
)

const TokenPanel = ({
	data,
	onChange,
	onRemove,
}: {
	data: TokenData
	onChange: (next: Partial<TokenData>) => void
	onRemove: () => void
}) => {
	const { t } = useTranslation()
	const isEditable = useLexicalEditable()
	const { problem } = useTokenPreview(data)
	const KindIcon = tokenIcons[data.token]

	return (
		<div className={`${baseClass}__content`}>
			<span className={`${baseClass}__kind`}>
				<KindIcon />
				{t(tokenKindLabel[data.token])}
			</span>
			{isEditable ? (
				<>
					{data.token !== 'scope' && (
						<Dropdown label={t(dateFormatLabel[data.format])}>
							{(close) =>
								DATE_FORMATS.map((format) => (
									<PopupList.Button
										active={format === data.format}
										key={format}
										onClick={() => {
											close()
											onChange({ format })
										}}
									>
										{t(dateFormatLabel[format])}
									</PopupList.Button>
								))
							}
						</Dropdown>
					)}
					{data.token === 'date' && (
						<div className={`${baseClass}__date`}>
							<DatePicker
								onChange={(value) => onChange({ date: value ? value.toISOString() : undefined })}
								pickerAppearance="dayAndTime"
								placeholder={t(keys.tokenPickDate)}
								value={data.date}
							/>
						</div>
					)}
					<button
						aria-label={t(keys.tokenRemove)}
						className={`${baseClass}__remove`}
						onClick={onRemove}
						onMouseDown={preventDefault}
						type="button"
					>
						<CloseMenuIcon />
					</button>
				</>
			) : null}
			{problem ? <p className={`${baseClass}__problem`}>{t(problem)}</p> : null}
		</div>
	)
}

const TokenEditor = ({ anchorElem }: { anchorElem: HTMLElement }) => {
	const [editor] = useLexicalComposerContext()
	const panelRef = useRef<HTMLDivElement | null>(null)
	const nodeRectRef = useRef<DOMRect | null>(null)
	const [active, setActive] = useState<{ key: string; data: TokenData } | null>(null)

	const hide = useCallback(() => {
		setActive(null)
		if (panelRef.current) {
			panelRef.current.style.opacity = '0'
			panelRef.current.style.transform = 'translate(-10000px, -10000px)'
		}
	}, [])

	const $update = useCallback(() => {
		if (!editor.isEditable()) {
			hide()
			return
		}
		const selection = $getSelection()
		const nodes = $isNodeSelection(selection) ? selection.getNodes() : []
		const node = nodes.length === 1 ? nodes[0] : null
		if (!$isContentLockTokenNode(node)) {
			hide()
			return
		}
		setActive({ key: node.getKey(), data: node.getData() })
		const rect = editor.getElementByKey(node.getKey())?.getBoundingClientRect()
		if (rect) {
			rect.y += 40
			nodeRectRef.current = rect
		}
	}, [editor, hide])

	useEffect(() => {
		const scroller = anchorElem.parentElement
		const update = () => editor.getEditorState().read($update)
		window.addEventListener('resize', update)
		scroller?.addEventListener('scroll', update)
		return () => {
			window.removeEventListener('resize', update)
			scroller?.removeEventListener('scroll', update)
		}
	}, [anchorElem.parentElement, editor, $update])

	useEffect(() => {
		editor.getEditorState().read($update)
		return mergeRegister(
			editor.registerUpdateListener(({ editorState }) => editorState.read($update)),
			editor.registerCommand(
				SELECTION_CHANGE_COMMAND,
				() => {
					$update()
					return false
				},
				COMMAND_PRIORITY_LOW
			)
		)
	}, [$update, editor])

	useLayoutEffect(() => {
		if (!active || !panelRef.current || !nodeRectRef.current) {
			return
		}
		setFloatingElemPositionForLinkEditor(nodeRectRef.current, panelRef.current, anchorElem)
		snapToPixels(panelRef.current)
	}, [active, anchorElem])

	const change = (next: Partial<TokenData>) => {
		if (!active) {
			return
		}
		editor.update(() => {
			const node = $getNodeByKey(active.key)
			if ($isContentLockTokenNode(node)) {
				node.setData({ ...node.getData(), ...next })
			}
		})
	}

	const remove = () => {
		if (!active) {
			return
		}
		editor.update(() => {
			$getNodeByKey(active.key)?.remove()
		})
	}

	return (
		<div className={baseClass} ref={panelRef}>
			{active ? <TokenPanel data={active.data} onChange={change} onRemove={remove} /> : null}
		</div>
	)
}

/**
 * The panel that appears while a token is selected, modelled on the stock link
 * editor: which value the token is (switching kinds is a matter of inserting
 * another), a dropdown for how a date is formatted, one for how a
 * date is formatted, the date itself when it is fixed, and remove.
 */
export const FloatingTokenEditorPlugin: PluginComponentWithAnchor<ContentLockTokenClientProps> = ({
	anchorElem = document.body,
}) => createPortal(<TokenEditor anchorElem={anchorElem} />, anchorElem)
