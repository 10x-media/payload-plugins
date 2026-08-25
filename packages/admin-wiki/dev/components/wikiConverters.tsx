'use client'

import type { JSXConverterArgs, JSXConvertersFunction } from '@payloadcms/richtext-lexical/react'
import type { ReactNode } from 'react'

/**
 * `blocks` and `inlineBlocks` are maps of their own, so each needs its own
 * spread: assigning `blocks` without one drops the plugin's callout and video
 * converters.
 *
 * The callout entry wraps the plugin's own converter rather than replacing it,
 * which is the seam a project reaches for most: decorate what the plugin
 * renders without restating it.
 */
export const wikiConverters: JSXConvertersFunction = ({ defaultConverters }) => {
	// Payload types `blocks` as `{}` unless the function is generic over the
	// project's block nodes, so reaching one by slug needs the cast.
	const blocks = defaultConverters.blocks as Record<
		string,
		((args: JSXConverterArgs) => ReactNode) | undefined
	>
	return {
		...defaultConverters,
		blocks: {
			...defaultConverters.blocks,
			wikiCallout: (args: JSXConverterArgs) => (
				<div data-dev-converter="wikiCallout">{blocks.wikiCallout?.(args)}</div>
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
	}
}
