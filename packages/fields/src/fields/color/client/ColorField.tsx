'use client'
import { useField } from '@payloadcms/ui'
import { mergeFieldStyles } from '@payloadcms/ui/shared'
import type { TextFieldClientProps, Validate } from 'payload'
import { text } from 'payload/shared'
import type React from 'react'
import { useCallback, useMemo } from 'react'
import { keys } from '../../../translations/keys'
import { useTranslation } from '../../../translations/useTranslation'
import type { ColorFieldClientOptions, ResolvedColorPreset } from '../options'
import { colorValueIssue } from '../valueIssue'
import { ColorInput } from './ColorInput'

const NO_PRESETS: ResolvedColorPreset[] = []

export type ColorFieldProps = {
	colorOptions: ColorFieldClientOptions
	presetsLabel?: string
	resolvedPresets?: ResolvedColorPreset[]
} & TextFieldClientProps

/** `ColorInput` bound to the document form through `useField`, with the field's validation. */
export const ColorField: React.FC<ColorFieldProps> = (props) => {
	const {
		colorOptions,
		field,
		field: {
			admin: { className, description, placeholder, readOnly: readOnlyFromAdmin } = {},
			label,
			localized,
			name,
			required,
		},
		path: pathFromProps,
		presetsLabel,
		readOnly: readOnlyFromProps,
		resolvedPresets = NO_PRESETS,
	} = props
	const { linked } = colorOptions
	const { t } = useTranslation()

	const memoizedValidate = useCallback<Validate<string>>(
		(value, options) => {
			const issue = colorValueIssue(value, { linked, presets: resolvedPresets })
			if (issue) return t(keys[issue])
			return text(value, { ...options, name, required, type: 'text' })
		},
		[linked, name, required, resolvedPresets, t]
	)

	const {
		customComponents: { AfterInput, BeforeInput, Description, Error: ErrorComponent, Label } = {},
		disabled,
		path,
		setValue,
		showError,
		value,
	} = useField<string>({ potentiallyStalePath: pathFromProps, validate: memoizedValidate })

	// renderField only maps permissions into the readOnly clientProp; admin.readOnly
	// reaches custom Field components solely via clientField.admin (native fields get
	// it merged client-side in RenderFields, a path custom components bypass)
	const isReadOnly = Boolean(readOnlyFromProps || disabled || readOnlyFromAdmin)
	const styles = useMemo(() => mergeFieldStyles(field), [field])

	return (
		<ColorInput
			AfterInput={AfterInput}
			BeforeInput={BeforeInput}
			className={className}
			Description={Description}
			description={description}
			Error={ErrorComponent}
			Label={Label}
			label={label}
			localized={localized}
			onChange={setValue}
			options={colorOptions}
			path={path}
			placeholder={typeof placeholder === 'string' ? placeholder : undefined}
			presets={resolvedPresets}
			presetsLabel={presetsLabel}
			readOnly={isReadOnly}
			required={required}
			showError={showError}
			style={styles}
			value={value}
		/>
	)
}
