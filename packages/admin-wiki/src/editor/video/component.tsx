'use client'

import { useLexicalDocumentDrawer } from '@payloadcms/richtext-lexical/client'
import { $getNodeByKey } from '@payloadcms/richtext-lexical/lexical'
import { useLexicalComposerContext } from '@payloadcms/richtext-lexical/lexical/react/LexicalComposerContext'
import { useLexicalEditable } from '@payloadcms/richtext-lexical/lexical/react/useLexicalEditable'
import { Button, useConfig } from '@payloadcms/ui'
import type { CollectionSlug, DefaultDocumentIDType } from 'payload'
import { useCallback, useReducer } from 'react'

import { resolveClientLabel } from '../../components/TargetSelect/clientBlocks'
import { GuideVideo } from '../../components/Video/GuideVideo'
import { useWikiMediaDoc } from '../../components/Video/useWikiMediaDoc'
import { keys } from '../../translations/keys'
import { useTranslation } from '../../translations/useTranslation'
import { OPEN_WIKI_VIDEO_DRAWER_COMMAND } from './commands'
import type { WikiVideoData } from './videoNode'
import './video-node.css'

export type WikiVideoNodeViewProps = {
	data: WikiVideoData
	nodeKey: string
}

/**
 * The video node as it renders inside the editor, built to read as a sibling of
 * Payload's own upload node: one bordered card, the media on top, round swap and
 * remove actions floating in from the top right on hover, and the filename as a
 * link into the media document.
 *
 * The one deliberate departure is the meta row, which sits below the player
 * rather than floating over its bottom edge as core's does. A video owns that
 * strip for its own transport controls, and an overlay there would cover the
 * scrubber on every video in the guide.
 */
export const WikiVideoNodeView = ({ data, nodeKey }: WikiVideoNodeViewProps) => {
	const [editor] = useLexicalComposerContext()
	const isEditable = useLexicalEditable()
	const { i18n, t } = useTranslation()
	const { getEntityConfig } = useConfig()
	const [cacheBust, bustCache] = useReducer((count: number) => count + 1, 0)
	const { doc } = useWikiMediaDoc(data.relationTo, data.value, cacheBust)

	/**
	 * `id` is typed as the host project's `DefaultDocumentIDType`, which its
	 * generated types narrow to whichever its database uses. The node stores
	 * `number | string` because the plugin ships for both, so the cast is what
	 * hands the wider stored value to the narrower project-local type. It is a
	 * no-op in a project whose ids are numbers and in this package's own
	 * typecheck, where no generated types exist to narrow it.
	 */
	const { closeDocumentDrawer, DocumentDrawer, DocumentDrawerToggler } = useLexicalDocumentDrawer({
		id: data.value as DefaultDocumentIDType,
		collectionSlug: data.relationTo as CollectionSlug,
	})

	const remove = useCallback(() => {
		editor.update(() => {
			$getNodeByKey(nodeKey)?.remove()
		})
	}, [editor, nodeKey])

	const swap = useCallback(() => {
		editor.dispatchCommand(OPEN_WIKI_VIDEO_DRAWER_COMMAND, { replace: { nodeKey } })
	}, [editor, nodeKey])

	const onSave = useCallback(() => {
		bustCache()
		closeDocumentDrawer()
	}, [closeDocumentDrawer])

	const collection = getEntityConfig({ collectionSlug: data.relationTo as CollectionSlug })
	const collectionLabel = resolveClientLabel(
		collection?.labels?.singular,
		i18n.language,
		data.relationTo
	)

	/**
	 * No wrapper element here: the node's own `createDOM` already renders the
	 * `.wiki-video-node` block that Lexical mounts this into, and repeating it
	 * would nest two bordered cards.
	 */
	return (
		<>
			<div className="wiki-video-node__card">
				<div className="wiki-video-node__media">
					<GuideVideo cacheBust={cacheBust} relationTo={data.relationTo} value={data.value} />
					{isEditable ? (
						<div className="wiki-video-node__actions" role="toolbar">
							<Button
								buttonStyle="icon-label"
								el="button"
								icon="swap"
								onClick={swap}
								round
								size="medium"
								tooltip={t(keys.videoSwap)}
							/>
							<Button
								buttonStyle="icon-label"
								el="button"
								icon="x"
								onClick={remove}
								round
								size="medium"
								tooltip={t(keys.videoRemove)}
							/>
						</div>
					) : null}
				</div>
				<div className="wiki-video-node__meta">
					<DocumentDrawerToggler className="wiki-video-node__filename-toggler">
						<strong className="wiki-video-node__filename">
							{doc?.filename || t(keys.videoUntitled)}
						</strong>
					</DocumentDrawerToggler>
					<span className="wiki-video-node__collection">{collectionLabel}</span>
				</div>
			</div>
			{data.value !== undefined ? <DocumentDrawer onSave={onSave} /> : null}
		</>
	)
}
