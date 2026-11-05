'use client'

import { Button, ChevronIcon } from '@payloadcms/ui'
import type { ComponentProps } from 'react'

type Props = {
	active: boolean
	/** Extra trigger props, such as the ones a `Popup` hands its `renderButton`. */
	buttonProps?: Partial<ComponentProps<typeof Button>>
	controls?: string
	label: string
	onToggle?: () => void
	open: boolean
	value: string
}

/**
 * One fixed filter: a trigger that always carries its current value, "All"
 * included, drawn as the list view's Filters button (secondary, chevron, selected
 * while open or filtering). Fixed rather than added on demand, so the bar stays
 * one row.
 */
export function FilterChoice({
	active,
	buttonProps,
	controls,
	label,
	onToggle,
	open,
	value,
}: Props) {
	return (
		<Button
			{...buttonProps}
			buttonStyle="secondary"
			className={['al-choice', active && 'al-choice--active', open && 'al-choice--open']
				.filter(Boolean)
				.join(' ')}
			extraButtonProps={{
				...buttonProps?.extraButtonProps,
				...(controls && { 'aria-controls': controls, 'aria-expanded': open }),
			}}
			icon={<ChevronIcon direction={open ? 'up' : 'down'} size={16} />}
			margin={false}
			onClick={onToggle ?? buttonProps?.onClick}
			selected={open || active}
			size="medium"
		>
			<span className="al-choice__label">{label}</span>
			{value && (
				<span className="al-choice__value" title={value}>
					{value}
				</span>
			)}
		</Button>
	)
}
