'use client'

import type React from 'react'

import { useSettingsOverlay } from './context'

export type SettingsOverlayButtonProps = {
	children?: React.ReactNode
	className?: string
	/** Document id for a collection item, or `'new'` for the create form. */
	id?: string
	/** Item slug inside the overlay. Omitted opens the rail's first row. */
	item?: string
	label?: string
	/** Overlay id. */
	overlay: string
}

/**
 * Opens an overlay from anywhere in the admin: a field, a list action, a dashboard card.
 *
 * Renders a bare button so the caller's own styling applies. Nothing here knows what the rail
 * holds, so a button pointing at an item the reader may not open simply lands on the first row
 * they can.
 */
export const SettingsOverlayButton: React.FC<SettingsOverlayButtonProps> = ({
	children,
	className,
	id,
	item,
	label,
	overlay,
}) => {
	const settings = useSettingsOverlay()

	return (
		<button
			className={className}
			onClick={() => {
				settings.open(overlay, { ...(item ? { item } : {}), ...(id ? { id } : {}) })
			}}
			type="button"
		>
			{children ?? label ?? null}
		</button>
	)
}
