'use client'

import { keys } from '../../translations/keys'
import { useTranslation } from '../../translations/useTranslation'

/** The subset of Payload's `DefaultCellComponentProps` this cell reads: the raw `fields` blocks array. */
type FieldCountCellProps = {
	cellData?: unknown[] | null
}

/**
 * List-view cell for the `fields` blocks field: a localized field count instead of Payload's
 * default "N Fields - Text, Email, ..." block-type summary.
 */
export const FieldCountCell = ({ cellData }: FieldCountCellProps) => {
	const { t } = useTranslation()
	const count = Array.isArray(cellData) ? cellData.length : 0
	return (
		<span>{t(count === 1 ? keys.cellFieldCountOne : keys.cellFieldCountOther, { count })}</span>
	)
}
