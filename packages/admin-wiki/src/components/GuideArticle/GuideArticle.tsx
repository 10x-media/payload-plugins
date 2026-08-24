'use client'

import type { SerializedEditorState } from '@payloadcms/richtext-lexical/lexical'
import {
	type JSXConverters,
	type JSXConvertersFunction,
	RichText,
} from '@payloadcms/richtext-lexical/react'
import { type ReactNode, useMemo } from 'react'

import {
	CALLOUT_BLOCK_SLUG,
	VIDEO_EMBED_BLOCK_SLUG,
	WIKI_VIDEO_NODE_TYPE,
} from '../../editor/constants'
import type { WikiConvertersFunction } from '../../options'
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
	/**
	 * Converters for this call site, applied after the project's own. Receives
	 * everything below it as `defaultConverters` and returns the map that renders,
	 * so it can drop a converter as well as add one.
	 */
	converters?: WikiConvertersFunction
	data: SerializedEditorState
	/** As {@link GuideArticleProps.blockRenderers}, for inline blocks. */
	inlineBlockRenderers?: Record<string, WikiBlockRenderer>
}

/** A block or inline block node, as far as a renderer is concerned. */
type BlockNode = { node: { fields: Record<string, unknown> } }

const renderersToConverters = (
	renderers: Record<string, WikiBlockRenderer>
): Record<string, (args: BlockNode) => ReactNode> =>
	Object.fromEntries(
		Object.entries(renderers).map(([slug, Renderer]) => [
			slug,
			({ node }: BlockNode) => <Renderer fields={node.fields} />,
		])
	)

/**
 * The plugin's own converters: everything a guide can contain that Payload does
 * not already render. Consumer layers are applied over this by
 * {@link composeConverters}.
 */
const buildGuideConverters =
	(
		blockRenderers: Record<string, WikiBlockRenderer>,
		inlineBlockRenderers: Record<string, WikiBlockRenderer>,
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
			...renderersToConverters(blockRenderers),
			[CALLOUT_BLOCK_SLUG]: ({ converters, node }: BlockNode & { converters: JSXConverters }) => (
				<Callout
					body={node.fields.body as SerializedEditorState | null | undefined}
					converters={converters}
					variant={node.fields.variant as string | null | undefined}
				/>
			),
			[VIDEO_EMBED_BLOCK_SLUG]: ({ node }: BlockNode) => (
				<VideoEmbed url={node.fields.url as string | undefined} />
			),
		},
		inlineBlocks: renderersToConverters(inlineBlockRenderers),
		[WIKI_VIDEO_NODE_TYPE]: ({ node }: { node: unknown }) => {
			const video = node as { relationTo?: string; value?: number | string }
			return <GuideVideo relationTo={video.relationTo ?? ''} value={video.value} />
		},
	})

/**
 * The single read renderer for guide content, shared by hover-card escalation
 * drawers, surface guide drawers, and the wiki view.
 */
export const GuideArticle = ({
	blockRenderers,
	className,
	converters,
	data,
	inlineBlockRenderers,
}: GuideArticleProps) => {
	const {
		blockRenderers: providerRenderers,
		converters: projectConverters,
		inlineBlockRenderers: providerInlineRenderers,
	} = useWikiTargets()
	const { idsByNode } = useMemo(() => collectGuideHeadings(data), [data])
	// Layer the converters: the plugin's own, then the project's, then the call site's.
	// Each layer is handed everything below it and returns the whole map, which is what
	// lets it drop a converter rather than only add one.
	const composed = useMemo(
		() => (args: Parameters<JSXConvertersFunction>[0]) =>
			[projectConverters, converters].reduce<JSXConverters>(
				(defaultConverters, layer) => layer?.({ defaultConverters }) ?? defaultConverters,
				buildGuideConverters(
					{ ...providerRenderers, ...blockRenderers },
					{ ...providerInlineRenderers, ...inlineBlockRenderers },
					idsByNode
				)(args)
			),
		[
			blockRenderers,
			converters,
			idsByNode,
			inlineBlockRenderers,
			projectConverters,
			providerInlineRenderers,
			providerRenderers,
		]
	)
	return (
		<div className={['wiki-guide-article', className].filter(Boolean).join(' ')}>
			<RichText converters={composed} data={data} disableContainer />
		</div>
	)
}
