'use client'

import {
	FieldDescription,
	type ReactSelectOption,
	SelectInput,
	useConfig,
	useField,
	withCondition,
} from '@payloadcms/ui'
import { mergeFieldStyles } from '@payloadcms/ui/shared'
import type { TextFieldClientProps } from 'payload'
import { useMemo } from 'react'
import { keys } from '../translations/keys'
import { useTranslation } from '../translations/useTranslation'
import { useAnalyticsGoals } from './useAnalyticsGoals'

/** Admin placeholders are a plain string or a locale map; SelectInput wants one string. */
const resolvePlaceholder = (
	placeholder: Record<string, string> | string | undefined,
	locale: string
): string | undefined =>
	typeof placeholder === 'string' ? placeholder : (placeholder?.[locale] ?? placeholder?.en)

/**
 * Goal picker for a {@link goalField}: lists the config goals merged with the goals
 * collection for the caller's scope and stores the picked goal's slug. While the fetch is
 * in flight the picker renders with no options rather than a notice, so a slow answer
 * never reads as "this install has no goals". Once it settles, an empty scope and a failed
 * fetch each say so below the input, next to the field's own description rather than in
 * place of it, and the picker stays editable either way so a stored slug can still be
 * cleared.
 */
const GoalSelectFieldComponent = (props: TextFieldClientProps) => {
	const { field, path: pathFromProps, readOnly } = props
	const { i18n, t } = useTranslation()
	const { collection, error, goals } = useAnalyticsGoals()
	const {
		customComponents: { AfterInput, BeforeInput, Description, Error: ErrorComponent, Label } = {},
		disabled,
		path,
		setValue,
		showError,
		value,
	} = useField<string>({ potentiallyStalePath: pathFromProps })
	const {
		config: {
			routes: { admin: adminRoute },
		},
	} = useConfig()

	const options = useMemo(
		() => (goals ?? []).map((goal) => ({ label: goal.name, value: goal.slug })),
		[goals]
	)
	const style = useMemo(() => mergeFieldStyles(field), [field])

	const empty = goals !== null && goals.length === 0
	const manageHref = collection ? `${adminRoute}/collections/${collection.slug}` : null
	const notice = empty ? (
		<div className="field-description">
			{t(keys.fieldGoalEmpty)}
			{manageHref ? (
				<>
					{' '}
					<a href={manageHref}>{t(keys.fieldGoalManage)}</a>
				</>
			) : null}
		</div>
	) : error ? (
		<div className="field-description">{t(keys.fieldGoalError)}</div>
	) : null

	return (
		<SelectInput
			AfterInput={AfterInput}
			BeforeInput={BeforeInput}
			className={field.admin?.className}
			Description={
				notice ? (
					<>
						{Description ?? <FieldDescription description={field.admin?.description} path={path} />}
						{notice}
					</>
				) : (
					Description
				)
			}
			description={field.admin?.description}
			Error={ErrorComponent}
			isClearable={!field.required}
			Label={Label}
			label={field.label}
			localized={field.localized}
			name={field.name}
			onChange={(selected: ReactSelectOption | ReactSelectOption[]) => {
				const option = Array.isArray(selected) ? selected[0] : selected
				setValue(option?.value ? String(option.value) : null)
			}}
			options={options}
			path={path}
			placeholder={resolvePlaceholder(field.admin?.placeholder, i18n.language)}
			readOnly={readOnly || disabled || field.admin?.readOnly}
			required={field.required}
			showError={showError}
			style={style}
			value={value}
		/>
	)
}

export const GoalSelectField = withCondition(GoalSelectFieldComponent)
