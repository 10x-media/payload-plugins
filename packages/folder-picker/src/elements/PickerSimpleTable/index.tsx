'use client'

import type React from 'react'

import './index.scss'

const baseClass = 'simple-table'

type TableProps = {
	readonly appearance?: 'condensed' | 'default'
	readonly className?: string
	readonly headerCells: React.ReactNode[]
	readonly tableRows: React.ReactNode[]
}

export const PickerSimpleTable = ({
	appearance,
	className,
	headerCells,
	tableRows,
}: TableProps) => {
	return (
		<div
			className={[className, baseClass, appearance && `${baseClass}--appearance-${appearance}`]
				.filter(Boolean)
				.join(' ')}
		>
			<table cellPadding={0} cellSpacing={0} className={`${baseClass}__table`}>
				<thead className={`${baseClass}__thead`}>
					<tr className={`${baseClass}__tr`}>{headerCells}</tr>
				</thead>
				<tbody className={`${baseClass}__tbody`}>{tableRows}</tbody>
			</table>
		</div>
	)
}

export const PickerTableHeader = ({
	children,
	className,
	...rest
}: React.ThHTMLAttributes<HTMLTableCellElement>) => (
	<th className={[`${baseClass}__th`, className].filter(Boolean).join(' ')} {...rest}>
		{children}
	</th>
)

export const PickerTableCell = ({
	children,
	className,
	...rest
}: React.TdHTMLAttributes<HTMLTableCellElement>) => (
	<td className={[`${baseClass}__td`, className].filter(Boolean).join(' ')} {...rest}>
		{children}
	</td>
)
