'use client'

import type { SerializedBlockNode } from '@payloadcms/richtext-lexical'
import type { JSXConvertersFunction } from '@payloadcms/richtext-lexical/react'

/**
 * Consumer converters, proving `options.editor.converters`. Replaces the
 * plugin's own `link` converter rather than adding beside it, which is what the
 * function form is for: the returned map is the one that renders, so a project
 * can drop or restate what the plugin put there.
 *
 * `blocks` and `inlineBlocks` are maps of their own, so each needs its own
 * spread: assigning `blocks` without one drops the plugin's callout and video
 * converters.
 */
export const wikiConverters: JSXConvertersFunction = ({ defaultConverters }) => ({
	...defaultConverters,
	blocks: {
		...defaultConverters.blocks,
		devTip: ({ node }: { node: SerializedBlockNode<{ tip?: string }> }) => (
			<aside data-dev-converter="devTip">
				<strong>Dev tip:</strong> {node.fields.tip}
			</aside>
		),
	},
	link: ({ node, nodesToJSX }) => (
		<a
			data-dev-converter="link"
			href={typeof node.fields.url === 'string' ? node.fields.url : undefined}
			rel="noopener noreferrer"
			target="_blank"
		>
			{nodesToJSX({ nodes: node.children })} ↗
		</a>
	),
})
