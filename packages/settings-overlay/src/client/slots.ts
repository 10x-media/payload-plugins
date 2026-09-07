import type React from 'react'

/**
 * Slot replacements for one overlay, already rendered on the server.
 *
 * A slot is not "render my component here": it is a props contract plus the hooks that give the
 * replacement the state it can no longer compute itself. `RailItem` gets its row through
 * `useSettingsItemState(slug)`, `RailGroup` renders its rows with `<SettingsRailItems>`, and
 * anything panel-wide reads `useSettingsPanel()`. Without those a slot would be a fork.
 *
 * Rendering happens in the plugin's server provider, so a slot may be a server or a client
 * component; only serializable props cross the boundary, which is why the dynamic half arrives
 * through context instead.
 */
export type OverlaySlots = {
	Empty?: React.ReactNode
	Header?: React.ReactNode
	Panel?: React.ReactNode
	Rail?: React.ReactNode
	/** Keyed by translated group label; the ungrouped block is the empty string. */
	RailGroup?: Record<string, React.ReactNode>
	/** Keyed by item slug. */
	RailItem?: Record<string, React.ReactNode>
	Search?: React.ReactNode
}

/** The key `RailGroup` slots use for the block that has no heading. */
export const UNGROUPED_KEY = ''
