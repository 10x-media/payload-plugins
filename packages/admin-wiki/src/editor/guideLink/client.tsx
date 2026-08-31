'use client'

import type { ToolbarGroup } from '@payloadcms/richtext-lexical'
import {
	createClientFeature,
	getSelectedNode,
	toolbarFeatureButtonsGroupWithItems,
} from '@payloadcms/richtext-lexical/client'
import {
	$getSelection,
	$isRangeSelection,
	type LexicalNode,
} from '@payloadcms/richtext-lexical/lexical'
import { $findMatchingParent } from '@payloadcms/richtext-lexical/lexical/utils'

import { keys, type TranslationKey } from '../../translations/keys'
import { OPEN_WIKI_GUIDE_LINK_DRAWER_COMMAND } from './commands'
import { FloatingGuideLinkEditorPlugin } from './FloatingGuideLinkEditor'
import { WikiGuideLinkPlugin } from './GuideLinkPlugin'
import {
	$isWikiGuideLinkNode,
	TOGGLE_WIKI_GUIDE_LINK_COMMAND,
	WikiGuideLinkNode,
} from './guideLinkNode'
import type { WikiGuideLinkClientProps } from './server'

const GuideLinkIcon = () => (
	<svg
		aria-hidden="true"
		className="icon"
		fill="none"
		focusable="false"
		height="20"
		viewBox="0 0 20 20"
		width="20"
		xmlns="http://www.w3.org/2000/svg"
	>
		<path
			d="M5.5 3.5h6.2l2.8 2.8v10.2h-9z"
			stroke="currentColor"
			strokeLinejoin="round"
			strokeWidth="1.5"
		/>
		<path d="M11.5 3.7v2.9h2.9" stroke="currentColor" strokeWidth="1.5" />
		<path
			d="M7.75 11h4.5M7.75 13.5h3"
			stroke="currentColor"
			strokeLinecap="round"
			strokeWidth="1.5"
		/>
	</svg>
)

/**
 * Lexical hands toolbar items an `i18n` rather than letting them call a hook, so
 * the key is resolved by hand against this plugin's own namespace.
 */
const guideLinkLabel =
	() =>
	({ i18n }: { i18n: { t: unknown } }) =>
		(i18n.t as (key: TranslationKey) => string)(keys.guideLinkFeatureLabel)

/**
 * One button, in both toolbars, doing what a link button does: with text
 * selected it opens the guide picker, and with the cursor inside a guide link it
 * is lit and takes the link back off. Disabled only on a selection that is
 * neither, because a link with no words to sit on is the one thing this node
 * cannot be; a bare cursor inside an existing link still has words, so removing
 * one never asks the author to select it first.
 */
const toolbarGroups: ToolbarGroup[] = [
	toolbarFeatureButtonsGroupWithItems([
		{
			ChildComponent: GuideLinkIcon,
			isActive: ({ selection }) =>
				$isRangeSelection(selection) &&
				$findMatchingParent(getSelectedNode(selection), $isWikiGuideLinkNode) !== null,
			isEnabled: ({ selection }) => {
				if (!$isRangeSelection(selection)) {
					return false
				}
				return (
					$findMatchingParent(getSelectedNode(selection), $isWikiGuideLinkNode) !== null ||
					selection.getTextContent().length > 0
				)
			},
			key: 'wikiGuideLink',
			label: guideLinkLabel(),
			onSelect: ({ editor, isActive }) => {
				if (isActive) {
					editor.dispatchCommand(TOGGLE_WIKI_GUIDE_LINK_COMMAND, null)
					return
				}
				// Read the nodes out now: opening the drawer takes focus, and what the
				// author had selected is the one thing the picker cannot ask for later.
				let nodes: LexicalNode[] = []
				editor.getEditorState().read(() => {
					const selection = $getSelection()
					nodes = $isRangeSelection(selection) ? selection.getNodes() : []
				})
				if (nodes.length === 0) {
					return
				}
				editor.dispatchCommand(OPEN_WIKI_GUIDE_LINK_DRAWER_COMMAND, { nodes })
			},
			order: 3,
		},
	]),
]

export const WikiGuideLinkFeatureClient = createClientFeature<WikiGuideLinkClientProps>(
	({ props }) => ({
		nodes: [WikiGuideLinkNode],
		plugins: [
			{ Component: WikiGuideLinkPlugin, position: 'normal' },
			{ Component: FloatingGuideLinkEditorPlugin, position: 'floatingAnchorElem' },
		],
		sanitizedClientFeatureProps: props,
		toolbarFixed: { groups: toolbarGroups },
		toolbarInline: { groups: toolbarGroups },
	})
)
