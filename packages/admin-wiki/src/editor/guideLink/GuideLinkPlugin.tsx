'use client'

import type { PluginComponent } from '@payloadcms/richtext-lexical'
import { useLexicalListDrawer } from '@payloadcms/richtext-lexical/client'
import { COMMAND_PRIORITY_EDITOR, COMMAND_PRIORITY_LOW } from '@payloadcms/richtext-lexical/lexical'
import { useLexicalComposerContext } from '@payloadcms/richtext-lexical/lexical/react/LexicalComposerContext'
import { mergeRegister } from '@payloadcms/richtext-lexical/lexical/utils'
import type { ListDrawerProps } from '@payloadcms/ui'
import type { CollectionSlug } from 'payload'
import { useCallback, useEffect, useMemo, useState } from 'react'

import {
	OPEN_WIKI_GUIDE_LINK_DRAWER_COMMAND,
	type OpenWikiGuideLinkDrawerPayload,
} from './commands'
import {
	$toggleWikiGuideLink,
	TOGGLE_WIKI_GUIDE_LINK_COMMAND,
	type ToggleWikiGuideLinkPayload,
	WikiGuideLinkNode,
} from './guideLinkNode'
import type { WikiGuideLinkClientProps } from './server'

/**
 * The feature's one editor plugin: it owns the toggle command and hosts the
 * guides list drawer that every entry point opens. The toolbar and the floating
 * editor only dispatch; nothing else mounts a drawer of its own.
 */
export const WikiGuideLinkPlugin: PluginComponent<WikiGuideLinkClientProps> = ({ clientProps }) => {
	const [editor] = useLexicalComposerContext()
	const [nodes, setNodes] = useState<OpenWikiGuideLinkDrawerPayload['nodes']>([])
	// The configured slug is a runtime string, which a host that generated its
	// types narrows every collection argument away from.
	const pagesSlug = clientProps.pagesSlug as CollectionSlug
	// Memoized for the reason the video feature documents at length:
	// `useListDrawer` builds its drawer inside a `useMemo` keyed on these, so a
	// fresh array each render remounts the whole drawer subtree.
	const collectionSlugs = useMemo(() => [pagesSlug], [pagesSlug])
	const { closeListDrawer, ListDrawer, openListDrawer } = useLexicalListDrawer({
		collectionSlugs,
		selectedCollection: pagesSlug,
	})

	useEffect(() => {
		if (!editor.hasNodes([WikiGuideLinkNode])) {
			throw new Error('@10x-media/admin-wiki: WikiGuideLinkNode is not registered on the editor')
		}
		return mergeRegister(
			editor.registerCommand<null | ToggleWikiGuideLinkPayload>(
				TOGGLE_WIKI_GUIDE_LINK_COMMAND,
				(payload) => {
					$toggleWikiGuideLink(payload)
					return true
				},
				COMMAND_PRIORITY_LOW
			),
			editor.registerCommand<OpenWikiGuideLinkDrawerPayload>(
				OPEN_WIKI_GUIDE_LINK_DRAWER_COMMAND,
				(payload) => {
					setNodes(payload.nodes)
					openListDrawer()
					return true
				},
				COMMAND_PRIORITY_EDITOR
			)
		)
	}, [editor, openListDrawer])

	const onSelect = useCallback<NonNullable<ListDrawerProps['onSelect']>>(
		({ doc }) => {
			closeListDrawer()
			editor.dispatchCommand(TOGGLE_WIKI_GUIDE_LINK_COMMAND, {
				guide: doc.id as number | string,
				nodes,
			})
		},
		[closeListDrawer, editor, nodes]
	)

	return <ListDrawer onSelect={onSelect} />
}
