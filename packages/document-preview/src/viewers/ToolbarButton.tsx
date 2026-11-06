'use client'

import { Button } from '@payloadcms/ui'
import type { ReactNode } from 'react'

type ToolbarButtonProps = {
	children?: ReactNode
	disabled?: boolean
	/** An icon-only button when there are no children. */
	icon?: ReactNode
	/** Accessible name and tooltip; needed for an icon-only button. */
	label?: string
	onClick: () => void
	/** A toggle's state: rendered as Payload's selected ghost button and `aria-pressed`. */
	pressed?: boolean
}

/** One control of a viewer's toolbar: Payload's medium ghost button. */
export const ToolbarButton = ({
	children,
	disabled,
	icon,
	label,
	onClick,
	pressed,
}: ToolbarButtonProps) => (
	<Button
		aria-label={label}
		aria-pressed={pressed}
		buttonStyle="ghost"
		disabled={disabled}
		icon={icon}
		margin={false}
		onClick={onClick}
		selected={pressed}
		size="medium"
		tooltip={label}
	>
		{children}
	</Button>
)
