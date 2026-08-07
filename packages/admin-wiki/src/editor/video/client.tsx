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
	$getSelection,
	$isRangeSelection,
	COMMAND_PRIORITY_EDITOR,
	createCommand,
	type LexicalCommand,
} from '@payloadcms/richtext-lexical/lexical'
import { useLexicalComposerContext } from '@payloadcms/richtext-lexical/lexical/react/LexicalComposerContext'
import { $insertNodeToNearestRoot, mergeRegister } from '@payloadcms/richtext-lexical/lexical/utils'
import type { ListDrawerProps } from '@payloadcms/ui'
import { useCallback, useEffect } from 'react'

import { GuideVideo } from '../../components/Video/GuideVideo'
import { keys } from '../../translations/keys'
import { useTranslation } from '../../translations/useTranslation'
import type { WikiVideoClientProps } from './server'
import { type SerializedWikiVideoNode, type WikiVideoData, WikiVideoServerNode } from './videoNode'

export const INSERT_WIKI_VIDEO_COMMAND: LexicalCommand<WikiVideoData> = createCommand(
	'INSERT_WIKI_VIDEO_COMMAND'
)

export const OPEN_WIKI_VIDEO_DRAWER_COMMAND: LexicalCommand<void> = createCommand(
	'OPEN_WIKI_VIDEO_DRAWER_COMMAND'
)

const WikiVideoEditor = ({ data, nodeKey }: { data: WikiVideoData; nodeKey: string }) => {
	const [editor] = useLexicalComposerContext()
	const { t } = useTranslation()
	return (
		<div className="wiki-video-editor" contentEditable={false}>
			{editor.isEditable() ? (
				<button
					className="wiki-video-editor__remove"
					onClick={() => {
						editor.update(() => {
							$getNodeByKey(nodeKey)?.remove()
						})
					}}
					type="button"
				>
					{t(keys.videoRemove)}
				</button>
			) : null}
			<GuideVideo relationTo={data.relationTo} value={data.value} />
		</div>
	)
}

/** Client node: same data as the server node, plus the inline editor player. */
export class WikiVideoNode extends WikiVideoServerNode {
	static override importJSON(serializedNode: SerializedWikiVideoNode): WikiVideoNode {
		return $createWikiVideoNode({
			relationTo: serializedNode.relationTo,
			value: serializedNode.value,
		})
	}

	override decorate() {
		return <WikiVideoEditor data={this.getData()} nodeKey={this.getKey()} />
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
 * Registers the insert command and hosts the media list drawer the toolbar and
 * slash menu open; picking a document inserts the video node at the cursor.
 */
const WikiVideoPlugin: PluginComponent<WikiVideoClientProps> = ({ clientProps }) => {
	const [editor] = useLexicalComposerContext()
	const mediaSlug = clientProps.mediaSlug
	const { closeListDrawer, ListDrawer, openListDrawer } = useLexicalListDrawer({
		collectionSlugs: [mediaSlug],
		filterOptions: { [mediaSlug]: { mimeType: { like: 'video' } } },
		selectedCollection: mediaSlug,
	})

	useEffect(() => {
		return mergeRegister(
			editor.registerCommand<WikiVideoData>(
				INSERT_WIKI_VIDEO_COMMAND,
				(payload) => {
					const selection = $getSelection()
					if (!$isRangeSelection(selection)) {
						return false
					}
					$insertNodeToNearestRoot($createWikiVideoNode(payload))
					return true
				},
				COMMAND_PRIORITY_EDITOR
			),
			editor.registerCommand(
				OPEN_WIKI_VIDEO_DRAWER_COMMAND,
				() => {
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
			editor.dispatchCommand(INSERT_WIKI_VIDEO_COMMAND, {
				relationTo: collectionSlug,
				value: doc.id as number | string,
			})
		},
		[closeListDrawer, editor]
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
						editor.dispatchCommand(OPEN_WIKI_VIDEO_DRAWER_COMMAND, undefined)
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
						editor.dispatchCommand(OPEN_WIKI_VIDEO_DRAWER_COMMAND, undefined)
					},
				},
			]),
		],
	},
})
