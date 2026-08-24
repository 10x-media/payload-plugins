'use client'

import type { WikiConvertersFunction } from '@10x-media/admin-wiki/types'

/**
 * Consumer converters, proving `options.editor.converters`. Replaces the
 * plugin's own `link` converter rather than adding beside it, which is what the
 * function form is for: the returned map is the one that renders, so a project
 * can drop or restate what the plugin put there.
 */
export const wikiConverters: WikiConvertersFunction = ({ defaultConverters }) => ({
	...defaultConverters,
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
