'use client'
import { Button } from '@payloadcms/ui'
import type React from 'react'

export type ActionKind = 'clear' | 'edit' | 'generate' | 'undo'

/**
 * Thin-stroke glyphs on the eye's 16x12 canvas, each drawn centered on
 * (8, 6) so the mark sits in the middle of its clickable area, matching the
 * eye beside which they render.
 */
const GLYPHS: Record<ActionKind, React.ReactNode> = {
	// × matching react-select's clear indicator.
	clear: <path className="stroke" d="M4.5 2.5L11.5 9.5M11.5 2.5L4.5 9.5" />,
	// Pencil.
	edit: (
		<path
			className="stroke"
			d="M3.2 11.5L3.7 9L10.2 2.5C10.75 1.95 11.65 1.95 12.2 2.5C12.75 3.05 12.75 3.95 12.2 4.5L5.7 11L3.2 11.5Z"
			strokeLinejoin="round"
		/>
	),
	// Circular arrows, the rotate/regenerate convention.
	generate: (
		<>
			<path className="stroke" d="M13 6A5 5 0 0 0 4.5 2.8M3 6A5 5 0 0 0 11.5 9.2" />
			<path className="stroke" d="M4.5 0.8V3H6.7M11.5 11.2V9H9.3" strokeLinejoin="round" />
		</>
	),
	// Counter-clockwise undo arrow.
	undo: (
		<>
			<path className="stroke" d="M3.5 3.75H9A3.5 3.5 0 0 1 9 10.75H5" />
			<path className="stroke" d="M6 1.25L3.5 3.75L6 6.25" strokeLinejoin="round" />
		</>
	),
}

/**
 * One write-only action, rendered with the same Button shell, icon canvas, and
 * (for attached placement) input-segment chrome as the reveal eye, so a row of
 * actions reads as part of the input and never changes the field's height.
 */
export const ActionButton: React.FC<{
	attached?: boolean
	kind: ActionKind
	label: string
	onClick: () => void
	pressed?: boolean
}> = ({ attached, kind, label, onClick, pressed }) => (
	<Button
		aria-label={label}
		buttonStyle="none"
		className={[
			'tenx-protected-field__eye',
			attached ? 'tenx-protected-field__eye--attached' : 'tenx-protected-field__eye--floating',
			'tenx-protected-field__action',
		]
			.filter(Boolean)
			.join(' ')}
		extraButtonProps={pressed === undefined ? undefined : { 'aria-pressed': pressed }}
		icon={
			<svg
				aria-hidden="true"
				className="tenx-protected-field__eye-icon"
				viewBox="0 0 16 12"
				xmlns="http://www.w3.org/2000/svg"
			>
				{GLYPHS[kind]}
			</svg>
		}
		margin={false}
		onClick={onClick}
		tooltip={label}
	/>
)
