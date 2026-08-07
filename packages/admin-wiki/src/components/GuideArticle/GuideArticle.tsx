'use client'

import type { SerializedEditorState } from '@payloadcms/richtext-lexical/lexical'
import { type JSXConvertersFunction, RichText } from '@payloadcms/richtext-lexical/react'
import { useMemo } from 'react'

import {
	CALLOUT_BLOCK_SLUG,
	GUIDE_LINK_BLOCK_SLUG,
	VIDEO_EMBED_BLOCK_SLUG,
	WIKI_VIDEO_NODE_TYPE,
} from '../../editor/constants'
import { GuideVideo } from '../Video/GuideVideo'
import { VideoEmbed } from '../Video/VideoEmbed'
import { useWikiTargets, type WikiBlockRenderer } from '../WikiProvider/WikiProvider'
import { Callout } from './Callout'
import { GuideLink, type GuideLinkFields } from './GuideLink'
import './guide-article.css'

export type { WikiBlockRenderer } from '../WikiProvider/WikiProvider'

export type GuideArticleProps = {
	/**
	 * Renderers for consumer editor blocks, keyed by block slug, merged over the
	 * ones the provider resolved from `options.editor.blocks`. The built-in
	 * callout renderer is always present and cannot be overridden.
	 */
	blockRenderers?: Record<string, WikiBlockRenderer>
	className?: string
	data: SerializedEditorState
}

const buildConverters =
	(blockRenderers: Record<string, WikiBlockRenderer>): JSXConvertersFunction =>
	({ defaultConverters }) => ({
		...defaultConverters,
		blocks: {
			...Object.fromEntries(
				Object.entries(blockRenderers).map(([slug, Renderer]) => [
					slug,
					({ node }: { node: { fields: Record<string, unknown> } }) => (
						<Renderer fields={node.fields} />
					),
				])
			),
			[CALLOUT_BLOCK_SLUG]: ({ node }: { node: { fields: Record<string, unknown> } }) => (
				<Callout
					body={node.fields.body as SerializedEditorState | null | undefined}
					variant={node.fields.variant as string | null | undefined}
				/>
			),
			[VIDEO_EMBED_BLOCK_SLUG]: ({ node }: { node: { fields: Record<string, unknown> } }) => (
				<VideoEmbed url={node.fields.url as string | undefined} />
			),
		},
		[WIKI_VIDEO_NODE_TYPE]: ({ node }: { node: unknown }) => {
			const video = node as { relationTo?: string; value?: number | string }
			return <GuideVideo relationTo={video.relationTo ?? ''} value={video.value} />
		},
		inlineBlocks: {
			[GUIDE_LINK_BLOCK_SLUG]: ({ node }: { node: { fields: Record<string, unknown> } }) => (
				<GuideLink fields={node.fields as GuideLinkFields} />
			),
		},
		link: ({ node, nodesToJSX }) => (
			<a
				href={typeof node.fields.url === 'string' ? node.fields.url : undefined}
				rel="noopener noreferrer"
				target="_blank"
			>
				{nodesToJSX({ nodes: node.children })}
			</a>
		),
	})

/**
 * The single read renderer for guide content, shared by hover-card escalation
 * drawers, surface guide drawers, and the wiki view.
 */
export const GuideArticle = ({ blockRenderers, className, data }: GuideArticleProps) => {
	const { blockRenderers: providerRenderers } = useWikiTargets()
	const converters = useMemo(
		() => buildConverters({ ...providerRenderers, ...blockRenderers }),
		[blockRenderers, providerRenderers]
	)
	return (
		<div className={['wiki-guide-article', className].filter(Boolean).join(' ')}>
			<RichText converters={converters} data={data} disableContainer />
		</div>
	)
}
