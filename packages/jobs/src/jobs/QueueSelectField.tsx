'use client'

import { SelectInput, useField } from '@payloadcms/ui'
import type { OptionObject, TextFieldClientProps } from 'payload'
import type { FC } from 'react'

type QueueSelectFieldProps = TextFieldClientProps & { options?: string[] }

/**
 * Select UI over the text-backed queue field. The data layer stays text so
 * `payload.jobs.queue()` can keep targeting arbitrary queue names; the
 * configured options only shape the admin input. A stored value outside the
 * list (a historical or programmatic queue name) is surfaced as an extra
 * option so the document renders it instead of a blank control.
 */
export const QueueSelectField: FC<QueueSelectFieldProps> = ({
	field,
	options = [],
	path,
	readOnly,
}) => {
	const { disabled, setValue, showError, value } = useField<string>({ path })
	const values = value && !options.includes(value) ? [value, ...options] : options
	const selectOptions: OptionObject[] = values.map((queue) => ({ label: queue, value: queue }))
	const locked = Boolean(readOnly || disabled)
	return (
		<SelectInput
			description={field.admin?.description}
			label={field.label}
			name={field.name}
			onChange={(option) => {
				if (locked) {
					return
				}
				setValue(!Array.isArray(option) && typeof option?.value === 'string' ? option.value : null)
			}}
			options={selectOptions}
			path={path}
			readOnly={locked}
			required={field.required}
			showError={showError}
			value={value}
		/>
	)
}
