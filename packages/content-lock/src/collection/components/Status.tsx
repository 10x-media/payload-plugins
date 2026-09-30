'use client'

import { FieldLabel, Pill, useField } from '@payloadcms/ui'
import type { DefaultCellComponentProps, SelectFieldClientComponent } from 'payload'

import { useTranslation } from '../../translations/useTranslation'
import { isLockStage, stageLabel, stagePillStyle } from '../stage'

/** A colour-coded pill for a window's stage: red active, yellow announced, blue pending, grey otherwise. */
export const StatusPill = ({ status }: { status: unknown }) => {
	const { t } = useTranslation()
	if (!isLockStage(status)) {
		return null
	}
	return (
		<Pill pillStyle={stagePillStyle[status]} size="small">
			{t(stageLabel[status])}
		</Pill>
	)
}

/** List cell for the stage. */
export const StatusCell = ({ cellData }: DefaultCellComponentProps) => (
	<StatusPill status={cellData} />
)

/** Sidebar field for the stage: the label and the pill, nothing to edit. */
export const StatusField: SelectFieldClientComponent = ({ field, path }) => {
	const { value } = useField<string>({ path: path ?? field.name })
	return (
		<div className="field-type content-lock-status-field">
			<FieldLabel label={field.label} path={path} />
			<StatusPill status={value} />
		</div>
	)
}
