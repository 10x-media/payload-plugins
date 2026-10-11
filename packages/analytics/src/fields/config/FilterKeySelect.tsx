'use client'

import {
	FieldDescription,
	type FieldType,
	type ReactSelectOption,
	SelectInput,
} from '@payloadcms/ui'
import { mergeFieldStyles } from '@payloadcms/ui/shared'
import type { TextFieldClientProps } from 'payload'
import { useMemo } from 'react'
import { keys } from '../../translations/keys'
import type { Translate } from '../../translations/server'

interface KeyOption {
	label: string
	value: string
}

/**
 * The offered keys as options. A stored key no longer offered is listed first, so it stays named
 * and can be cleared; a stored value that is no key at all shows as itself.
 */
export const keyOptions = <K extends string>(args: {
	offered: readonly K[]
	stored: string | null | undefined
	isKey: (value: unknown) => value is K
	labelOf: (key: K) => string
}): KeyOption[] => {
	const { offered, stored, isKey, labelOf } = args
	const options = offered.map((key) => ({ label: labelOf(key), value: key }))
	if (!stored || offered.some((key) => key === stored)) {
		return options
	}
	return [{ label: isKey(stored) ? labelOf(stored) : stored, value: stored }, ...options]
}

/** The note under a filter picker: the source list failed, or it answered and offers nothing. */
export const filterNotice = (
	t: Translate,
	state: { error: boolean; resolved: boolean; offered: number }
): string | null => {
	if (state.error) {
		return t(keys.fieldFilterError)
	}
	return state.resolved && state.offered === 0 ? t(keys.fieldFilterEmpty) : null
}

interface FilterKeySelectProps {
	field: TextFieldClientProps['field']
	fieldState: FieldType<string>
	readOnly: boolean | undefined
	options: KeyOption[]
	/** Shown under the field's own description rather than in place of it. */
	notice: string | null
	isClearable: boolean
}

/** Payload's select for a filter key picker, storing the picked key or null when emptied. */
export function FilterKeySelect(props: FilterKeySelectProps) {
	const { field, fieldState, notice } = props
	const {
		customComponents: { AfterInput, BeforeInput, Description, Error: ErrorComponent, Label } = {},
		disabled,
		path,
		setValue,
		showError,
		value,
	} = fieldState
	const style = useMemo(() => mergeFieldStyles(field), [field])
	return (
		<SelectInput
			AfterInput={AfterInput}
			BeforeInput={BeforeInput}
			className={field.admin?.className}
			Description={
				notice ? (
					<>
						{Description ?? <FieldDescription description={field.admin?.description} path={path} />}
						<div className="field-description">{notice}</div>
					</>
				) : (
					Description
				)
			}
			description={field.admin?.description}
			Error={ErrorComponent}
			isClearable={props.isClearable}
			Label={Label}
			label={field.label}
			name={field.name}
			onChange={(selected: ReactSelectOption | ReactSelectOption[]) => {
				const option = Array.isArray(selected) ? selected[0] : selected
				setValue(option?.value ? String(option.value) : null)
			}}
			options={props.options}
			path={path}
			readOnly={props.readOnly || disabled || field.admin?.readOnly}
			showError={showError}
			style={style}
			value={value}
		/>
	)
}
