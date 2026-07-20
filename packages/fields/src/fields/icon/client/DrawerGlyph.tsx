'use client'

import React from 'react'
import type { IconNode } from '../../../types'

// lucide and tabler share a 24x24 outline canvas; these are lucide-react's own
// defaultAttributes, so a glyph rendered here is pixel-identical to the per-icon
// component. Radix (a 15x15 fill set) has no node-data and stays on the Icon path.
const GLYPH_VIEWBOX = '0 0 24 24'
const GLYPH_STROKE_WIDTH = 2

export type DrawerGlyphProps = { nodes: IconNode[]; size: number }

/**
 * Renders one glyph as inline SVG from bulk node-data, matching lucide-react's
 * `iconNode.map(([tag, attrs]) => createElement(tag, attrs))`. The drawer loads a
 * library's node-data once, so a grid cell costs a cheap element tree instead of
 * the per-icon dynamic import that made large libraries scroll poorly.
 */
export const DrawerGlyph: React.FC<DrawerGlyphProps> = React.memo(({ nodes, size }) => (
	<svg
		aria-hidden="true"
		fill="none"
		height={size}
		stroke="currentColor"
		strokeLinecap="round"
		strokeLinejoin="round"
		strokeWidth={GLYPH_STROKE_WIDTH}
		viewBox={GLYPH_VIEWBOX}
		width={size}
	>
		{nodes.map(([tag, attrs], index) => React.createElement(tag, { key: index, ...attrs }))}
	</svg>
))
DrawerGlyph.displayName = 'DrawerGlyph'
