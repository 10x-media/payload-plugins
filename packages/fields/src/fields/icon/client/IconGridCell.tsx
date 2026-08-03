'use client'

import { Tooltip } from '@payloadcms/ui'
import React, { useState } from 'react'
import type { IconCanvas, IconMeta, IconNode } from '../../../types'
import type { AdapterComponentsEntry } from '../shared/adapterComponents'
import { resolveIconDisplay } from '../shared/iconLabel'
import { DrawerGlyph } from './DrawerGlyph'

export type IconGridCellProps = {
	/** Canvas the library's bulk glyphs draw on; absent means the outline default. */
	canvas?: IconCanvas
	entry: AdapterComponentsEntry | undefined
	focused: boolean
	icon: IconMeta
	index: number
	isSelected: boolean
	/** Admin language, so a per-locale library label resolves in the cell. */
	language: string
	/** Bulk glyph data for inline rendering; when absent the cell falls back to the per-icon Icon. */
	nodes: IconNode[] | undefined
	onSelect: (icon: IconMeta) => void
	registerRef: (index: number, element: HTMLButtonElement | null) => void
}

/**
 * One square in the icon grid. The name is not rendered in-flow, because that
 * variance broke grid alignment; it lives on the accessible name and a
 * hover/focus tooltip.
 *
 * Those two deliberately differ. The accessible name carries the label alone, so
 * a screen reader browsing a country library announces "Hungary" rather than
 * "Hungary HUN" 215 times. The tooltip carries the raw name alongside it, because
 * it is the only surface where an editor can discover that "Hungary" stores as
 * `HUN`, which they need in order to write frontend code against the value.
 */
export const IconGridCell: React.FC<IconGridCellProps> = React.memo(
	({ canvas, entry, focused, icon, index, isSelected, language, nodes, onSelect, registerRef }) => {
		const [showTooltip, setShowTooltip] = useState(false)
		const display = resolveIconDisplay({ language, meta: icon, name: icon.name })
		return (
			<div className="tenx-icon-drawer__cell" role="presentation">
				<button
					aria-label={display.label}
					aria-selected={isSelected}
					className={
						isSelected
							? 'tenx-icon-drawer__cell-button tenx-icon-drawer__cell-button--selected'
							: 'tenx-icon-drawer__cell-button'
					}
					onBlur={() => setShowTooltip(false)}
					onClick={() => onSelect(icon)}
					onFocus={() => setShowTooltip(true)}
					onMouseEnter={() => setShowTooltip(true)}
					onMouseLeave={() => setShowTooltip(false)}
					ref={(element) => registerRef(index, element)}
					role="option"
					tabIndex={focused ? 0 : -1}
					type="button"
				>
					<Tooltip show={showTooltip} staticPositioning>
						{display.label}
						{display.code ? (
							<span className="tenx-icon-drawer__cell-code">{display.code}</span>
						) : null}
					</Tooltip>
					<span className="tenx-icon-drawer__glyph">
						{nodes ? (
							<DrawerGlyph canvas={canvas} nodes={nodes} size={24} />
						) : entry ? (
							<entry.Icon name={icon.name} size={24} />
						) : null}
					</span>
				</button>
			</div>
		)
	}
)
IconGridCell.displayName = 'IconGridCell'
