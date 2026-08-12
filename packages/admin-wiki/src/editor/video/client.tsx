'use client'

import type { PluginComponent } from '@payloadcms/richtext-lexical'
import {
	createClientFeature,
	slashMenuBasicGroupWithItems,
	toolbarAddDropdownGroupWithItems,
	useLexicalListDrawer,
} from '@payloadcms/richtext-lexical/client'
import {
	$applyNodeReplacement,
	$getNodeByKey,
	$getPreviousSelection,
	$getSelection,
	$isRangeSelection,
	COMMAND_PRIORITY_EDITOR,
} from '@payloadcms/richtext-lexical/lexical'
import { useLexicalComposerContext } from '@payloadcms/richtext-lexical/lexical/react/LexicalComposerContext'
import { $insertNodeToNearestRoot, mergeRegister } from '@payloadcms/richtext-lexical/lexical/utils'
import type { ListDrawerProps } from '@payloadcms/ui'
import type { CollectionSlug } from 'payload'
import { useCallback, useEffect, useMemo, useState } from 'react'

import {
	INSERT_WIKI_VIDEO_COMMAND,
	OPEN_WIKI_VIDEO_DRAWER_COMMAND,
	type OpenWikiVideoDrawerPayload,
} from './commands'
import { WikiVideoNodeView } from './component'
import type { WikiVideoClientProps } from './server'
import { type SerializedWikiVideoNode, type WikiVideoData, WikiVideoServerNode } from './videoNode'

/** Client node: same data as the server node, plus the editor card. */
export class WikiVideoNode extends WikiVideoServerNode {
	static override importJSON(serializedNode: SerializedWikiVideoNode): WikiVideoNode {
		return $createWikiVideoNode({
			relationTo: serializedNode.relationTo,
			value: serializedNode.value,
		})
	}

	override decorate() {
		return <WikiVideoNodeView data={this.getData()} nodeKey={this.getKey()} />
	}
}

export function $createWikiVideoNode(data: WikiVideoData): WikiVideoNode {
	return $applyNodeReplacement(new WikiVideoNode(data))
}

const WikiVideoIcon = () => (
	<svg
		aria-hidden="true"
		fill="none"
		focusable="false"
		height="20"
		viewBox="0 0 20 20"
		width="20"
		xmlns="http://www.w3.org/2000/svg"
	>
		<rect height="12" rx="2" stroke="currentColor" strokeWidth="1.5" width="14" x="3" y="4" />
		<path d="M8.75 7.5l4.5 2.5-4.5 2.5v-5z" fill="currentColor" />
	</svg>
)

/**
 * Registers the insert command and hosts the media list drawer the toolbar, the
 * slash menu, and a card's swap action all open. Picking a document inserts the
 * video node at the cursor, or replaces the node the swap came from.
 */
const WikiVideoPlugin: PluginComponent<WikiVideoClientProps> = ({ clientProps }) => {
	const [editor] = useLexicalComposerContext()
	const [replaceNodeKey, setReplaceNodeKey] = useState<null | string>(null)
	// The configured slug is a runtime string, which a host that generated its
	// types narrows every collection argument away from.
	const mediaSlug = clientProps.mediaSlug as CollectionSlug
	/**
	 * Both arguments are memoized because `useListDrawer` builds its drawer as an
	 * inline component inside a `useMemo` keyed on them. A fresh object each
	 * render is a fresh component type, so React remounts the whole drawer subtree
	 * instead of updating it, and this component re-renders on every modal state
	 * change (`useLexicalListDrawer` reads `useModal`). That is exactly what
	 * happens when the reader clicks "create new": opening the nested document
	 * drawer changed the modal state, the remount discarded the drawer that had
	 * just registered that modal slug, and the create form never appeared. Core's
	 * upload feature never hits this only because it passes no `filterOptions`.
	 */
	const collectionSlugs = useMemo(() => [mediaSlug], [mediaSlug])
	const filterOptions = useMemo(
		() => ({ [mediaSlug]: { mimeType: { like: 'video' } } }),
		[mediaSlug]
	)
	const { closeListDrawer, ListDrawer, openListDrawer } = useLexicalListDrawer({
		collectionSlugs,
		filterOptions,
		selectedCollection: mediaSlug,
	})

	useEffect(() => {
		return mergeRegister(
			editor.registerCommand<WikiVideoData>(
				INSERT_WIKI_VIDEO_COMMAND,
				(payload) => {
					/**
					 * The previous selection is the fallback the built-in upload feature
					 * uses for the same reason: the drawer that dispatched this took focus
					 * away from the editor, and `useLexicalListDrawer` only restores the
					 * cursor a tick after the modal closes, which is after this runs.
					 */
					const selection = $getSelection() ?? $getPreviousSelection()
					if (!$isRangeSelection(selection)) {
						return false
					}
					$insertNodeToNearestRoot($createWikiVideoNode(payload))
					return true
				},
				COMMAND_PRIORITY_EDITOR
			),
			editor.registerCommand<OpenWikiVideoDrawerPayload>(
				OPEN_WIKI_VIDEO_DRAWER_COMMAND,
				(payload) => {
					setReplaceNodeKey(payload?.replace ? payload.replace.nodeKey : null)
					openListDrawer()
					return true
				},
				COMMAND_PRIORITY_EDITOR
			)
		)
	}, [editor, openListDrawer])

	const onSelect = useCallback<NonNullable<ListDrawerProps['onSelect']>>(
		({ collectionSlug, doc }) => {
			closeListDrawer()
			const data: WikiVideoData = {
				relationTo: collectionSlug,
				value: doc.id as number | string,
			}
			if (!replaceNodeKey) {
				editor.dispatchCommand(INSERT_WIKI_VIDEO_COMMAND, data)
				return
			}
			// A swap replaces in place, so it neither needs nor can use the cursor:
			// the node being replaced is the position.
			editor.update(() => {
				$getNodeByKey(replaceNodeKey)?.replace($createWikiVideoNode(data))
			})
		},
		[closeListDrawer, editor, replaceNodeKey]
	)

	return <ListDrawer onSelect={onSelect} />
}

const featureLabel =
	() =>
	({ i18n }: { i18n: { t: unknown } }) =>
		(i18n.t as (key: string) => string)('lexical:wikiVideo:label')

export const WikiVideoFeatureClient = createClientFeature<WikiVideoClientProps>({
	nodes: [WikiVideoNode],
	plugins: [{ Component: WikiVideoPlugin, position: 'normal' }],
	slashMenu: {
		groups: [
			slashMenuBasicGroupWithItems([
				{
					Icon: WikiVideoIcon,
					key: 'wikiVideo',
					keywords: ['video', 'movie', 'player', 'mp4'],
					label: featureLabel(),
					onSelect: ({ editor }) => {
						editor.dispatchCommand(OPEN_WIKI_VIDEO_DRAWER_COMMAND, { replace: false })
					},
				},
			]),
		],
	},
	toolbarFixed: {
		groups: [
			toolbarAddDropdownGroupWithItems([
				{
					ChildComponent: WikiVideoIcon,
					key: 'wikiVideo',
					label: featureLabel(),
					onSelect: ({ editor }) => {
						editor.dispatchCommand(OPEN_WIKI_VIDEO_DRAWER_COMMAND, { replace: false })
					},
				},
			]),
		],
	},
})
