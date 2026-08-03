'use client'

import React from 'react'
import type { IconCanvas, IconNode } from '../../../types'

// lucide and tabler share a 24x24 outline canvas; these are lucide-react's own
// defaultAttributes, so a glyph rendered here is pixel-identical to the per-icon
// component. They stay the defaults, which is what keeps every library declaring no
// canvas rendering exactly as it always has.
const DEFAULT_CANVAS: Required<IconCanvas> = {
	fill: 'none',
	stroke: 'currentColor',
	strokeLinecap: 'round',
	strokeLinejoin: 'round',
	strokeWidth: 2,
	viewBox: '0 0 24 24',
}

export type DrawerGlyphProps = {
	/** Layer-declared canvas; omitted fields fall back to the lucide outline convention. */
	canvas?: IconCanvas
	nodes: IconNode[]
	size: number
}

const renderNodes = (nodes: IconNode[]): React.ReactNode[] =>
	nodes.map(([tag, attrs, children], index) =>
		React.createElement(tag, { key: index, ...attrs }, children ? renderNodes(children) : undefined)
	)

/**
 * Renders one glyph as inline SVG from bulk node-data, matching lucide-react's
 * `iconNode.map(([tag, attrs]) => createElement(tag, attrs))`. The drawer loads a
 * library's node-data once, so a grid cell costs a cheap element tree instead of
 * the per-icon dynamic import that made large libraries scroll poorly.
 *
 * The canvas is declared per layer rather than hardcoded, so a filled 15x15 set is as
 * renderable here as a 24x24 stroked one. Nodes may nest, which a flat list cannot
 * express and which arbitrary SVG needs.
 */
export const DrawerGlyph: React.FC<DrawerGlyphProps> = React.memo(({ canvas, nodes, size }) => {
	const resolved = canvas ? { ...DEFAULT_CANVAS, ...canvas } : DEFAULT_CANVAS
	return (
		<svg
			aria-hidden="true"
			fill={resolved.fill}
			height={size}
			stroke={resolved.stroke}
			strokeLinecap={resolved.strokeLinecap}
			strokeLinejoin={resolved.strokeLinejoin}
			strokeWidth={resolved.strokeWidth}
			viewBox={resolved.viewBox}
			width={size}
		>
			{renderNodes(nodes)}
		</svg>
	)
})
DrawerGlyph.displayName = 'DrawerGlyph'
