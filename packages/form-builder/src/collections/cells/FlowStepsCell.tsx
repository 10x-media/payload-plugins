'use client'

import { keys } from '../../translations/keys'
import { useTranslation } from '../../translations/useTranslation'

/** The subset of Payload's `DefaultCellComponentProps` this cell reads: the raw `flow` json value. */
type FlowStepsCellProps = {
	cellData?: { steps?: unknown[] } | null
}

const stepCountOf = (cellData: FlowStepsCellProps['cellData']): number =>
	Array.isArray(cellData?.steps) ? cellData.steps.length : 0

/** List-view cell for the `flow` json field: a localized step count instead of raw JSON. */
export const FlowStepsCell = ({ cellData }: FlowStepsCellProps) => {
	const { t } = useTranslation()
	const count = stepCountOf(cellData)
	if (count === 0) {
		return <span>—</span>
	}
	return <span>{t(count === 1 ? keys.cellStepCountOne : keys.cellStepCountOther, { count })}</span>
}
