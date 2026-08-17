'use client'

import type { PluginComponentWithAnchor } from '@payloadcms/richtext-lexical'
import {
	getSelectedNode,
	setFloatingElemPositionForLinkEditor,
} from '@payloadcms/richtext-lexical/client'
import {
	$getNodeByKey,
	$getSelection,
	$isLineBreakNode,
	$isRangeSelection,
	COMMAND_PRIORITY_HIGH,
	COMMAND_PRIORITY_LOW,
	KEY_ESCAPE_COMMAND,
	SELECTION_CHANGE_COMMAND,
} from '@payloadcms/richtext-lexical/lexical'
import { useLexicalComposerContext } from '@payloadcms/richtext-lexical/lexical/react/LexicalComposerContext'
import { useLexicalEditable } from '@payloadcms/richtext-lexical/lexical/react/useLexicalEditable'
import { $findMatchingParent, mergeRegister } from '@payloadcms/richtext-lexical/lexical/utils'
import {
	CloseMenuIcon,
	EditIcon,
	useConfig,
	useTranslation as usePayloadTranslation,
} from '@payloadcms/ui'
import { requests } from '@payloadcms/ui/shared'
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

import { keys } from '../../translations/keys'
import { useTranslation } from '../../translations/useTranslation'
import { OPEN_WIKI_GUIDE_LINK_DRAWER_COMMAND } from './commands'
import {
	$isWikiGuideLinkNode,
	TOGGLE_WIKI_GUIDE_LINK_COMMAND,
	type WikiGuideLinkNode,
} from './guideLinkNode'
import type { WikiGuideLinkClientProps } from './server'
import './guide-link-node.css'

/** Keeps a mousedown on the panel from collapsing the selection it is describing. */
const preventDefault = (event: { preventDefault: () => void }): void => event.preventDefault()

const GuideLinkEditor = ({
	anchorElem,
	pagesSlug,
}: {
	anchorElem: HTMLElement
	pagesSlug: string
}) => {
	const [editor] = useLexicalComposerContext()
	const isEditable = useLexicalEditable()
	const { t } = useTranslation()
	const { i18n } = usePayloadTranslation()
	const { config } = useConfig()

	const panelRef = useRef<HTMLDivElement | null>(null)
	const nodeRectRef = useRef<DOMRect | null>(null)
	const fetchedRef = useRef<null | string>(null)

	const [activeNodeKey, setActiveNodeKey] = useState<null | string>(null)
	const [title, setTitle] = useState<null | string>(null)

	const hide = useCallback(() => {
		setActiveNodeKey(null)
		setTitle(null)
		fetchedRef.current = null
		if (panelRef.current) {
			panelRef.current.style.opacity = '0'
			panelRef.current.style.transform = 'translate(-10000px, -10000px)'
		}
	}, [])

	/**
	 * The guide's own title, read straight from the API rather than through the
	 * provider's guide cache: that cache is the reader's, and it holds published
	 * guides only, where an author linking to a guide they are still drafting is
	 * the ordinary case.
	 */
	const loadTitle = useCallback(
		(guide: number | string) => {
			// Keyed by language as well as by guide: the title is localized, so a
			// reader switching languages has to refetch rather than keep reading the
			// previous locale's.
			const key = `${i18n.language}:${guide}`
			if (fetchedRef.current === key) {
				return
			}
			fetchedRef.current = key
			setTitle(null)
			void requests
				.get(
					`${config.serverURL ?? ''}${config.routes.api}/${pagesSlug}/${encodeURIComponent(String(guide))}`,
					{
						headers: { 'Accept-Language': i18n.language },
						params: { depth: 0, draft: true },
					}
				)
				.then(async (response) => {
					if (!response.ok) {
						return
					}
					const doc = (await response.json()) as { title?: unknown }
					if (fetchedRef.current === key && typeof doc.title === 'string') {
						setTitle(doc.title)
					}
				})
				.catch(() => {
					// The panel falls back to the "unavailable" label; a failed lookup is
					// not worth a toast while the author is only passing the cursor over.
				})
		},
		[config.routes.api, config.serverURL, i18n.language, pagesSlug]
	)

	const $update = useCallback(() => {
		const selection = $getSelection()
		if (!$isRangeSelection(selection)) {
			hide()
			return
		}
		const node = $findMatchingParent(
			getSelectedNode(selection),
			$isWikiGuideLinkNode
		) as null | WikiGuideLinkNode
		// A selection reaching past this one link describes more than the panel can
		// speak for, so it says nothing.
		const spansOut = selection
			.getNodes()
			.filter((candidate) => !$isLineBreakNode(candidate))
			.some((candidate) => {
				const parent = $findMatchingParent(candidate, $isWikiGuideLinkNode)
				return (node && !node.is(parent)) || (parent && !parent.is(node))
			})
		if (node === null || spansOut) {
			hide()
			return
		}
		setActiveNodeKey(node.getKey())
		const guide = node.getGuide()
		if (guide !== null) {
			loadTitle(guide)
		}
		const rect = editor.getElementByKey(node.getKey())?.getBoundingClientRect()
		if (rect) {
			rect.y += 40
			nodeRectRef.current = rect
		}
	}, [editor, hide, loadTitle])

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
			),
			editor.registerCommand(
				KEY_ESCAPE_COMMAND,
				() => {
					if (!activeNodeKey) {
						return false
					}
					hide()
					return true
				},
				COMMAND_PRIORITY_HIGH
			)
		)
	}, [$update, activeNodeKey, editor, hide])

	// After React has painted the label, so the panel is positioned against its
	// real width rather than the previous guide's.
	// biome-ignore lint/correctness/useExhaustiveDependencies: `title` is the paint this waits for, not a value it reads.
	useLayoutEffect(() => {
		if (!activeNodeKey || !panelRef.current || !nodeRectRef.current) {
			return
		}
		setFloatingElemPositionForLinkEditor(nodeRectRef.current, panelRef.current, anchorElem)
	}, [activeNodeKey, anchorElem, title])

	const retarget = useCallback(() => {
		let nodes: ReturnType<WikiGuideLinkNode['getChildren']> = []
		editor.getEditorState().read(() => {
			const node = activeNodeKey ? $getNodeByKey(activeNodeKey) : null
			if ($isWikiGuideLinkNode(node)) {
				nodes = node.getChildren()
			}
		})
		editor.dispatchCommand(OPEN_WIKI_GUIDE_LINK_DRAWER_COMMAND, { nodes })
	}, [activeNodeKey, editor])

	return (
		<div className="wiki-guide-link-editor" ref={panelRef}>
			{activeNodeKey ? (
				<div className="wiki-guide-link-editor__content">
					<span className="wiki-guide-link-editor__title">{title ?? t(keys.guideUnavailable)}</span>
					{isEditable ? (
						<>
							<button
								aria-label={t(keys.guideLinkRetarget)}
								onClick={retarget}
								onMouseDown={preventDefault}
								type="button"
							>
								<EditIcon />
							</button>
							<button
								aria-label={t(keys.guideLinkRemove)}
								onClick={() => editor.dispatchCommand(TOGGLE_WIKI_GUIDE_LINK_COMMAND, null)}
								onMouseDown={preventDefault}
								type="button"
							>
								<CloseMenuIcon />
							</button>
						</>
					) : null}
				</div>
			) : null}
		</div>
	)
}

/**
 * The panel that appears while the cursor sits inside a guide link: which guide
 * it points at, and the two things an author does to it. Modelled on the stock
 * link editor, because that is the affordance an author already knows.
 */
export const FloatingGuideLinkEditorPlugin: PluginComponentWithAnchor<WikiGuideLinkClientProps> = ({
	anchorElem = document.body,
	clientProps,
}) =>
	createPortal(
		<GuideLinkEditor anchorElem={anchorElem} pagesSlug={clientProps.pagesSlug} />,
		anchorElem
	)
