'use client'

import {
	FieldDescription,
	FieldError,
	FieldLabel,
	fieldBaseClass,
	ReactSelect,
	type ReactSelectOption,
	RenderCustomComponent,
	useConfig,
	useField,
	withCondition,
} from '@payloadcms/ui'
import { mergeFieldStyles } from '@payloadcms/ui/shared'
import type { TextFieldClientProps } from 'payload'
import { useMemo } from 'react'
import { keys } from '../translations/keys'
import { useTranslation } from '../translations/useTranslation'
import { resolvePlaceholder } from './placeholder'
import type { GoalSource } from './resolver'
import { useAnalyticsGoals } from './useAnalyticsGoals'
import '../ui/analytics.css'

/**
 * Goal picker for a {@link goalField}, storing the slug. Optionless while loading, so a slow answer
 * never reads as "no goals"; built from Payload's parts because `SelectInput` cannot group options.
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

	/**
	 * Grouped by who made each goal (settings or admin), so an editor sees which are theirs to change;
	 * an empty group has no heading.
	 */
	const options = useMemo(() => {
		// The latent built-in goal is not among them: the endpoint leaves it out, and offering
		// a goal nobody declared would put it in documents that never meant to book against it.
		const headings: Array<{ label: string; sources: GoalSource[] }> = [
			{ label: t(keys.goalSourceBuiltin), sources: ['config', 'builtin'] },
			{ label: t(keys.goalSourceCollection), sources: ['collection'] },
		]
		const groups = headings
			.map(({ label, sources }) => ({
				label,
				options: (goals ?? [])
					.filter((goal) => sources.includes(goal.source))
					.map((goal) => ({ label: goal.name, value: goal.slug })),
			}))
			.filter((group) => group.options.length > 0)
		return groups.length > 1 ? groups : (groups[0]?.options ?? [])
	}, [goals, t])

	// An empty list rather than undefined: react-select reads it as nothing picked, where
	// undefined would hand the choice back to its own state and outlive a form reset.
	const selected = useMemo((): ReactSelectOption | ReactSelectOption[] => {
		if (!value) {
			return []
		}
		const goal = goals?.find((candidate) => candidate.slug === value)
		return { label: goal?.name ?? value, value }
	}, [goals, value])
	const style = useMemo(() => mergeFieldStyles(field), [field])
	const locked = Boolean(readOnly || disabled || field.admin?.readOnly)

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
		<div
			className={[
				fieldBaseClass,
				'select',
				'analytics-goal-select',
				field.admin?.className,
				showError && 'error',
				locked && 'read-only',
			]
				.filter(Boolean)
				.join(' ')}
			id={`field-${path.replace(/\./g, '__')}`}
			style={style}
		>
			<RenderCustomComponent
				CustomComponent={Label}
				Fallback={
					<FieldLabel
						label={field.label}
						localized={field.localized}
						path={path}
						required={field.required}
					/>
				}
			/>
			<div className={`${fieldBaseClass}__wrap`}>
				<RenderCustomComponent
					CustomComponent={ErrorComponent}
					Fallback={<FieldError path={path} showError={showError} />}
				/>
				{BeforeInput}
				<ReactSelect
					disabled={locked}
					isClearable={!field.required}
					onChange={(picked) => {
						const option = Array.isArray(picked) ? picked[0] : picked
						setValue(option?.value ? String(option.value) : null)
					}}
					options={options}
					placeholder={resolvePlaceholder(field.admin?.placeholder, i18n.language)}
					showError={showError}
					value={selected}
				/>
				{AfterInput}
			</div>
			<RenderCustomComponent
				CustomComponent={Description}
				Fallback={<FieldDescription description={field.admin?.description} path={path} />}
			/>
			{notice}
		</div>
	)
}

/** @internal */
export const GoalSelectField = withCondition(GoalSelectFieldComponent)
