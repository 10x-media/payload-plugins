//biome-ignore-all lint/a11y/useSemanticElements: I just porting this from old repo. Feel free to improve
'use client'

import React from 'react'

import { PickerTableCell } from '../PickerSimpleTable/index'
import './index.scss'

const baseClass = 'draggable-table-row'

type Props = {
	readonly columns: React.ReactNode[]
	readonly disabled?: boolean
	readonly isFocused?: boolean
	readonly isSelected?: boolean
	readonly isSelecting?: boolean
	readonly itemKey: string
	readonly onClick?: (e: React.MouseEvent) => void
	readonly onKeyDown?: (e: React.KeyboardEvent) => void
}

export function PickerTableRow({
	columns,
	disabled = false,
	isFocused,
	isSelected,
	isSelecting,
	itemKey,
	onClick,
	onKeyDown,
}: Props) {
	const ref = React.useRef<HTMLTableRowElement>(null)

	React.useEffect(() => {
		if (isFocused && ref.current) {
			ref.current.focus()
		} else if (!isFocused && ref.current) {
			ref.current.blur()
		}
	}, [isFocused])

	return (
		<tr
			className={[
				baseClass,
				isSelected && `${baseClass}--selected`,
				isSelecting && `${baseClass}--selecting`,
				disabled && `${baseClass}--disabled`,
				isFocused && `${baseClass}--focused`,
			]
				.filter(Boolean)
				.join(' ')}
			key={itemKey}
			onClick={disabled ? undefined : onClick}
			onKeyDown={disabled ? undefined : onKeyDown}
			ref={ref}
			role="button"
			tabIndex={disabled ? undefined : 0}
		>
			{columns.map((col, i) => (
				<PickerTableCell
					className={[
						`${baseClass}__cell-content`,
						i === 0 && `${baseClass}__first-td`,
						i === columns.length - 1 && `${baseClass}__last-td`,
					]
						.filter(Boolean)
						.join(' ')}
					// biome-ignore lint/suspicious/noArrayIndexKey: No harm in using index as key here
					key={`${itemKey}-${i}`}
				>
					{col}
				</PickerTableCell>
			))}
		</tr>
	)
}
