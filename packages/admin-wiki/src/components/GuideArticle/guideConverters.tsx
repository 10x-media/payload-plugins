'use client'

import type { SerializedEditorState } from '@payloadcms/richtext-lexical/lexical'
import type {
	JSXConverter,
	JSXConverterArgs,
	JSXConverters,
	JSXConvertersFunction,
} from '@payloadcms/richtext-lexical/react'

import {
	CALLOUT_BLOCK_SLUG,
	VIDEO_EMBED_BLOCK_SLUG,
	WIKI_VIDEO_NODE_TYPE,
} from '../../editor/constants'
import { GuideVideo } from '../Video/GuideVideo'
import { VideoEmbed } from '../Video/VideoEmbed'
import type { WikiBlockRenderer } from '../WikiProvider/WikiProvider'
import { Callout } from './Callout'
import { inlineConverters } from './inlineConverters'

/** A block or inline block node, as far as a renderer is concerned. */
type BlockNode = { node: { fields: Record<string, unknown> } }

const renderersToConverters = (
	renderers: Record<string, WikiBlockRenderer>
): Record<string, JSXConverter> =>
	Object.fromEntries(
		Object.entries(renderers).map(([slug, Renderer]) => [
			slug,
			({ converters, node, nodesToJSX }: JSXConverterArgs) => (
				<Renderer
					converters={converters}
					fields={(node as unknown as BlockNode['node']).fields}
					nodesToJSX={nodesToJSX}
				/>
			),
		])
	)

/**
 * The plugin's own converters: everything a guide can contain that Payload does
 * not already render. The consumer's own layer is applied over this in
 * `WikiProvider`.
 */
export const buildGuideConverters =
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
