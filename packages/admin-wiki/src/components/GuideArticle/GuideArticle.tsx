'use client'

import type { SerializedEditorState } from '@payloadcms/richtext-lexical/lexical'
import { type JSXConvertersFunction, RichText } from '@payloadcms/richtext-lexical/react'
import { useMemo } from 'react'

import {
	CALLOUT_BLOCK_SLUG,
	VIDEO_EMBED_BLOCK_SLUG,
	WIKI_VIDEO_NODE_TYPE,
} from '../../editor/constants'
import { collectGuideHeadings } from '../../shared/headings'
import { GuideVideo } from '../Video/GuideVideo'
import { VideoEmbed } from '../Video/VideoEmbed'
import { useWikiTargets, type WikiBlockRenderer } from '../WikiProvider/WikiProvider'
import { Callout } from './Callout'
import { inlineConverters } from './inlineConverters'
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
	(
		blockRenderers: Record<string, WikiBlockRenderer>,
		idsByNode: Map<object, string>
	): JSXConvertersFunction =>
	(args) => ({
		...inlineConverters(args),
		/**
		 * The default converter renders the tag and nothing else. Headings need an
		 * id for the table of contents to link to, and the id comes from the same
		 * walk the TOC itself used, keyed by node identity.
		 */
		heading: ({ node, nodesToJSX }) => {
			const Tag = node.tag
			return <Tag id={idsByNode.get(node as object)}>{nodesToJSX({ nodes: node.children })}</Tag>
		},
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
	})

/**
 * The single read renderer for guide content, shared by hover-card escalation
 * drawers, surface guide drawers, and the wiki view.
 */
export const GuideArticle = ({ blockRenderers, className, data }: GuideArticleProps) => {
	const { blockRenderers: providerRenderers } = useWikiTargets()
	const { idsByNode } = useMemo(() => collectGuideHeadings(data), [data])
	const converters = useMemo(
		() => buildConverters({ ...providerRenderers, ...blockRenderers }, idsByNode),
		[blockRenderers, idsByNode, providerRenderers]
	)
	return (
		<div className={['wiki-guide-article', className].filter(Boolean).join(' ')}>
			<RichText converters={converters} data={data} disableContainer />
		</div>
	)
}
