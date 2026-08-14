'use client'

import type { SerializedLexicalNode } from '@payloadcms/richtext-lexical/lexical'
import type { JSXConvertersFunction } from '@payloadcms/richtext-lexical/react'

import { WIKI_GUIDE_LINK_NODE_TYPE } from '../../editor/constants'
import { GuideLink } from './GuideLink'

/**
 * The converters every rendered wiki editor state needs, nested ones included:
 * guide links and plain links. Guide content adds blocks, headings and video on
 * top of these; a callout body, whose editor is inline-only, needs exactly this
 * much and no more.
 */
export const inlineConverters: JSXConvertersFunction = ({ defaultConverters }) => ({
	...defaultConverters,
	/**
	 * An element node, so its children are the link text and the converter has to
	 * descend into them; block converters take no children at all.
	 */
	[WIKI_GUIDE_LINK_NODE_TYPE]: ({ node, nodesToJSX }) => {
		const link = node as { children?: SerializedLexicalNode[]; guide?: null | number | string }
		return (
			<GuideLink guide={link.guide ?? null}>{nodesToJSX({ nodes: link.children ?? [] })}</GuideLink>
		)
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
