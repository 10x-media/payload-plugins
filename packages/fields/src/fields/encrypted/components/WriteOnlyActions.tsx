'use client'
import { CircledXIcon, RefreshIcon, Tooltip, WriteIcon } from '@payloadcms/ui'
import type React from 'react'
import { useState } from 'react'

export type ActionKind = 'clear' | 'edit' | 'generate' | 'undo'

/**
 * Payload's upload-editor reset arrow, which `@payloadcms/ui` draws but does not
 * export (beta.6), redrawn from its 24px path.
 *
 * @todo Import `ResetIcon` from `@payloadcms/ui` once it is exported, and drop this copy.
 */
const UndoIcon: React.FC = () => (
	<svg
		aria-hidden="true"
		className="icon icon--reset"
		fill="none"
		height="24"
		viewBox="0 0 24 24"
		width="24"
		xmlns="http://www.w3.org/2000/svg"
	>
		<path
			clipRule="evenodd"
			d="M8.14658 5.14631C8.34183 4.95119 8.65839 4.95113 8.85361 5.14631C9.04882 5.34152 9.04873 5.65806 8.85361 5.85334L7.70712 6.99982H12.0001C15.3137 6.99987 18 9.68623 18.0001 12.9998C18.0001 16.3135 15.3138 18.9998 12.0001 18.9998C8.68638 18.9998 6.00009 16.3135 6.00009 12.9998C6.00019 12.7238 6.22401 12.4998 6.50009 12.4998C6.77613 12.4999 6.99999 12.7238 7.00009 12.9998C7.00009 15.7612 9.23867 17.9998 12.0001 17.9998C14.7615 17.9998 17.0001 15.7612 17.0001 12.9998C17 10.2385 14.7614 7.99987 12.0001 7.99982H7.70712L8.85361 9.14631C9.04882 9.34152 9.04873 9.65806 8.85361 9.85334C8.65835 10.0486 8.34184 10.0486 8.14658 9.85334L6.14658 7.85334C5.95136 7.65807 5.95133 7.34155 6.14658 7.14631L8.14658 5.14631Z"
			fill="currentColor"
			fillRule="evenodd"
		/>
	</svg>
)

/**
 * Payload's own 24px glyph for each action, picked where Payload uses it for the
 * same job: the select clear indicator, the relationship edit pencil, the API key
 * regenerate arrows, and the upload editor's reset.
 */
const GLYPHS: Record<ActionKind, React.ReactNode> = {
	clear: <CircledXIcon size={24} />,
	edit: <WriteIcon size={24} />,
	generate: <RefreshIcon size={24} />,
	undo: <UndoIcon />,
}

/**
 * One write-only action, drawn with the same plain-button shell and 24px icon box
 * as the reveal eye, so a row of actions reads as part of the input and never
 * changes the field's height. The label doubles as a hover tooltip, as on
 * Payload's icon-only buttons.
 */
export const ActionButton: React.FC<{
	attached?: boolean
	kind: ActionKind
	label: string
	onClick: () => void
	pressed?: boolean
}> = ({ attached, kind, label, onClick, pressed }) => {
	const [showTooltip, setShowTooltip] = useState(false)
	return (
		<button
			aria-label={label}
			aria-pressed={pressed}
			className={[
				'tenx-protected-field__eye',
				attached ? 'tenx-protected-field__eye--attached' : 'tenx-protected-field__eye--floating',
				'tenx-protected-field__action',
			].join(' ')}
			onClick={() => {
				setShowTooltip(false)
				onClick()
			}}
			onPointerEnter={() => setShowTooltip(true)}
			onPointerLeave={() => setShowTooltip(false)}
			type="button"
		>
			<Tooltip show={showTooltip}>{label}</Tooltip>
			{GLYPHS[kind]}
		</button>
	)
}
