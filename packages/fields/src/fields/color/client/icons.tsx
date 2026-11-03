'use client'
import type React from 'react'

/**
 * Lucide's pipette at the scale of Payload's own icons: drawn in its 24px box and rendered at
 * 16px, so the 1.5 stroke lands as a 1px line, like the native line icons beside it.
 */
const ICON_SIZE = 16
const ICON_STROKE = (24 / ICON_SIZE) * 1

export const EyedropperIcon: React.FC = () => (
	<svg
		aria-hidden="true"
		className="icon icon--eyedropper"
		fill="none"
		height={ICON_SIZE}
		stroke="currentColor"
		strokeLinecap="round"
		strokeLinejoin="round"
		strokeWidth={ICON_STROKE}
		viewBox="0 0 24 24"
		width={ICON_SIZE}
		xmlns="http://www.w3.org/2000/svg"
	>
		<path d="m2 22 1-1h3l9-9" />
		<path d="M3 21v-3l9-9" />
		<path d="m15 6 3.4-3.4a2.1 2.1 0 1 1 3 3L18 9l.4.4a2.1 2.1 0 1 1-3 3l-3.8-3.8a2.1 2.1 0 1 1 3-3l.4.4Z" />
	</svg>
)
