'use client'

import type { DefaultCellComponentProps } from 'payload'

import { keys } from '../translations/keys'
import { useTranslation } from '../translations/useTranslation'

/** Attempts column cell: the count with an explanation of what it counts on hover. */
export const AttemptsCell = ({ cellData }: DefaultCellComponentProps) => {
	const { t } = useTranslation()
	return (
		<span style={{ cursor: 'help' }} title={t(keys.attemptsTooltip)}>
			{String(cellData ?? 0)}
		</span>
	)
}
