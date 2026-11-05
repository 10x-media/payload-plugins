'use client'

import {
	FieldDescription,
	FieldError,
	FieldLabel,
	fieldBaseClass,
	ReactSelect,
	type ReactSelectOption,
	RenderCustomComponent,
	useField,
	withCondition,
} from '@payloadcms/ui'
import { mergeFieldStyles } from '@payloadcms/ui/shared'
import type { NumberFieldClientProps } from 'payload'
import { type ChangeEvent, useEffect, useId, useMemo } from 'react'
import { keys } from '../translations/keys'
import { useTranslation } from '../translations/useTranslation'
import { selectComponents } from '../ui/components/LabeledSelect'
import { type GoalAmountFieldOptions, siblingPath } from './amountField'
import { currencyOptions } from './currencyOptions'
import { resolvePlaceholder } from './placeholder'
import '../ui/analytics.css'

/** @internal */
export type GoalAmountFieldProps = NumberFieldClientProps & GoalAmountFieldOptions

const isAmount = (value: unknown): value is number =>
	typeof value === 'number' && Number.isFinite(value)

const asCode = (value: unknown): string | undefined =>
	typeof value === 'string' && value !== '' ? value : undefined

/**
 * The Amount control for an {@link amountField}: Payload's number input beside the currency select,
 * which writes its shown default as soon as an amount is set so a save stores what it shows.
 */
const GoalAmountFieldComponent = (props: GoalAmountFieldProps) => {
	const {
		currencyPath: relativeCurrencyPath,
		defaultCurrency,
		field,
		path: pathFromProps,
		readOnly,
	} = props
	const { i18n, t } = useTranslation()
	const currencyInputId = useId()
	const {
		customComponents: { AfterInput, BeforeInput, Description, Error: ErrorComponent, Label } = {},
		disabled,
		formInitializing,
		path,
		setValue,
		showError,
		value,
	} = useField<number | null>({ potentiallyStalePath: pathFromProps })
	const currencyPath = siblingPath(path, relativeCurrencyPath)
	const currency = useField<string | null>({ path: currencyPath })
	const setCurrency = currency.setValue
	const stored = asCode(currency.value)
	const locked = Boolean(readOnly || disabled || field.admin?.readOnly)

	useEffect(() => {
		if (!formInitializing && !locked && isAmount(value) && !stored && defaultCurrency) {
			// Filling in the default is no edit of the editor's, so a goal opened with an amount
			// and no currency is not marked unsaved for it.
			setCurrency(defaultCurrency, true)
		}
	}, [defaultCurrency, formInitializing, locked, setCurrency, stored, value])

	const options = useMemo(
		() => currencyOptions(i18n.language, [stored, defaultCurrency]),
		[defaultCurrency, i18n.language, stored]
	)
	const style = useMemo(() => mergeFieldStyles(field), [field])
	const shownCode = stored ?? defaultCurrency
	const shown =
		shownCode === undefined
			? undefined
			: {
					value: shownCode,
					label: options.find((option) => option.value === shownCode)?.label ?? shownCode,
				}

	const onAmountChange = (event: ChangeEvent<HTMLInputElement>) => {
		const parsed = Number.parseFloat(event.target.value)
		setValue(Number.isNaN(parsed) ? null : parsed)
	}

	const onCurrencyChange = (picked: ReactSelectOption | ReactSelectOption[]) => {
		const option = Array.isArray(picked) ? picked[0] : picked
		if (typeof option?.value === 'string') {
			setCurrency(option.value)
		}
	}

	return (
		<div
			className={[
				fieldBaseClass,
				'analytics-goal-amount',
				field.admin?.className,
				locked && 'read-only',
			]
				.filter(Boolean)
				.join(' ')}
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
				{BeforeInput}
				<div className="analytics-goal-amount__row">
					<div
						className={[fieldBaseClass, 'number', showError && 'error'].filter(Boolean).join(' ')}
					>
						<div className={`${fieldBaseClass}__wrap`}>
							<RenderCustomComponent
								CustomComponent={ErrorComponent}
								Fallback={<FieldError path={path} showError={showError} />}
							/>
							<input
								disabled={locked}
								id={`field-${path.replace(/\./g, '__')}`}
								max={field.max}
								min={field.min}
								name={path}
								onChange={onAmountChange}
								onWheel={(event) => event.currentTarget.blur()}
								placeholder={resolvePlaceholder(field.admin?.placeholder, i18n.language)}
								step={typeof field.admin?.step === 'number' ? field.admin.step : 1}
								type="number"
								value={isAmount(value) ? value : ''}
							/>
						</div>
					</div>
					{/* Payload's SelectInput labels its wrapper, so the hidden label names the input itself. */}
					<div
						className={[
							fieldBaseClass,
							'select',
							currency.showError && 'error',
							locked && 'read-only',
						]
							.filter(Boolean)
							.join(' ')}
					>
						<label className="analytics-sr-only" htmlFor={currencyInputId}>
							{t(keys.goalFieldCurrency)}
						</label>
						<div className={`${fieldBaseClass}__wrap`}>
							<FieldError path={currencyPath} showError={currency.showError} />
							<ReactSelect
								components={selectComponents}
								disabled={locked}
								inputId={currencyInputId}
								isClearable={false}
								onChange={onCurrencyChange}
								options={options.map((option) => ({ value: option.value, label: option.label }))}
								placeholder={t(keys.goalFieldCurrency)}
								showError={currency.showError}
								{...(shown === undefined ? {} : { value: shown })}
							/>
						</div>
					</div>
				</div>
				{AfterInput}
			</div>
			<RenderCustomComponent
				CustomComponent={Description}
				Fallback={<FieldDescription description={field.admin?.description} path={path} />}
			/>
		</div>
	)
}

/** @internal */
export const GoalAmountField = withCondition(GoalAmountFieldComponent)
