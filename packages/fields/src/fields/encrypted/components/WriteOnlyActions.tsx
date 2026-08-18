'use client'
import { Button } from '@payloadcms/ui'
import type React from 'react'

export type ActionKind = 'clear' | 'edit' | 'generate' | 'undo'

/**
 * Thin-stroke glyphs on the eye's 16x12 canvas so every action inherits the
 * exact size and stroke treatment of the reveal eye beside which they render.
 */
const GLYPHS: Record<ActionKind, React.ReactNode> = {
	// × matching react-select's clear indicator.
	clear: (
		<>
			<path className="stroke" d="M5 2.5L11.5 9M11.5 2.5L5 9" />
		</>
	),
	// Pencil.
	edit: (
		<path
			className="stroke"
			d="M2.5 11.5L3 9L9.5 2.5C10.05 1.95 10.95 1.95 11.5 2.5C12.05 3.05 12.05 3.95 11.5 4.5L5 11L2.5 11.5Z"
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
			<path className="stroke" d="M3.5 4.5H9A3.5 3.5 0 0 1 9 11.5H5" />
			<path className="stroke" d="M6 2L3.5 4.5L6 7" strokeLinejoin="round" />
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
				<g transform="translate(1.5 0)">{GLYPHS[kind]}</g>
			</svg>
		}
		margin={false}
		onClick={onClick}
		tooltip={label}
	/>
)
