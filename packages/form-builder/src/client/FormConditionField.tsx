'use client'

import { FieldLabel, useField } from '@payloadcms/ui'
import type { Where } from 'payload'
import type { ConditionFieldType } from '../conditions/fieldTypes'
import { ConditionBuilder } from './ConditionBuilder'
import { toStaticLabel } from './toStaticLabel'

/** Props: standard JSON field client props plus the `conditionTypes` map we pass via clientProps. */
export type FormConditionFieldProps = {
	path?: string
	field?: { label?: unknown; name?: string }
	label?: unknown
	conditionTypes: Record<string, ConditionFieldType>
}

/**
 * The `Field` mounted on a form field's `visibleWhen`/`validateWhen` json column. Binds the field's own
 * path with `useField<Where>()` (the QueryPresetsWhereField precedent) and renders the native builder.
 */
export const FormConditionField = (props: FormConditionFieldProps) => {
	const { path, setValue, value } = useField<Where>()
	const label = toStaticLabel(props.field?.label ?? props.label)
	return (
		<div className="field-type" style={{ marginBlockEnd: '1rem' }}>
			<FieldLabel label={label} path={path} />
			<ConditionBuilder
				value={value ?? undefined}
				onChange={setValue}
				conditionTypes={props.conditionTypes}
				selfName={props.field?.name}
			/>
		</div>
	)
}
