'use client'

import { type ReactSelectOption, SelectInput, useConfig, useField } from '@payloadcms/ui'
import type { TextFieldClientProps } from 'payload'
import { useMemo } from 'react'
import { keys } from '../translations/keys'
import { useTranslation } from '../translations/useTranslation'
import { useAnalyticsGoals } from './useAnalyticsGoals'

/**
 * Goal picker for a {@link goalField}: lists the config goals merged with the goals
 * collection for the caller's scope and stores the picked goal's slug. While the fetch is
 * in flight the picker renders with no options rather than an empty state, so a slow
 * answer never reads as "this install has no goals"; once the answer is in and empty, the
 * field goes read-only and says so, with a link to the goals collection when there is one.
 */
export const GoalSelectField = (props: TextFieldClientProps) => {
	const { field, path: pathFromProps, readOnly } = props
	const { t } = useTranslation()
	const { collection, goals } = useAnalyticsGoals()
	const {
		customComponents: { AfterInput, BeforeInput, Description, Error: ErrorComponent, Label } = {},
		disabled,
		path,
		setValue,
		showError,
		value,
	} = useField<string>({ path: pathFromProps })
	const {
		config: {
			routes: { admin: adminRoute },
		},
	} = useConfig()

	const options = useMemo(
		() => (goals ?? []).map((goal) => ({ label: goal.name, value: goal.slug })),
		[goals]
	)
	const styles = useMemo(
		() => ({
			...field.admin?.style,
			...(field.admin?.width ? { width: field.admin.width } : {}),
		}),
		[field.admin?.style, field.admin?.width]
	)

	const empty = goals !== null && goals.length === 0
	const manageHref = collection ? `${adminRoute}/collections/${collection.slug}` : null

	return (
		<SelectInput
			AfterInput={AfterInput}
			BeforeInput={BeforeInput}
			className={field.admin?.className}
			Description={
				empty ? (
					<div className="field-description">
						{t(keys.fieldGoalEmpty)}
						{manageHref ? (
							<>
								{' '}
								<a href={manageHref}>{t(keys.fieldGoalManage)}</a>
							</>
						) : null}
					</div>
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
			readOnly={readOnly || disabled || field.admin?.readOnly || empty}
			required={field.required}
			showError={showError}
			style={styles}
			value={value}
		/>
	)
}
