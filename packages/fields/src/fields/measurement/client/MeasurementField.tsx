'use client'
import {
	FieldDescription,
	FieldError,
	FieldLabel,
	fieldBaseClass,
	Popup,
	RenderCustomComponent,
	useField,
} from '@payloadcms/ui'
import { mergeFieldStyles } from '@payloadcms/ui/shared'
import type { NumberFieldClientProps, Validate } from 'payload'
import { number } from 'payload/shared'
import type React from 'react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { keys } from '../../../translations/keys'
import { useTranslation } from '../../../translations/useTranslation'
import { formatMeasurement, unitLabel } from '../engine/format'
import { COMPOUNDS, isCompoundUnit, type UnitId } from '../engine/units'
import { resolveUnitForLocale } from '../engine/usages'
import type { MeasurementResolvedClientOptions } from '../options'
import { commitDrafts, draftsFor, type MeasurementDrafts, resolveDisplayUnit } from './editModel'
import { useMeasurementUnits } from './MeasurementUnitsProvider'
import './measurementField.css'

const baseClass = 'fields-measurement'

/**
 * Compound inputs size to their value so "5 ft 11 in" reads as one left-aligned
 * phrase. The half-ch keeps the caret off the edge; the clamp keeps an empty
 * input clickable and a runaway draft from pushing the row into overflow.
 */
const draftWidth = (draft: string): React.CSSProperties => ({
	width: `${Math.min(Math.max(draft.length, 2), 12) + 0.5}ch`,
})

export type MeasurementFieldProps = {
	measurementOptions: MeasurementResolvedClientOptions
} & NumberFieldClientProps

export const MeasurementField: React.FC<MeasurementFieldProps> = (props) => {
	const {
		field,
		field: {
			admin: { className, description, placeholder, readOnly: readOnlyFromAdmin } = {},
			label,
			localized,
			max,
			min,
			name,
			required,
		},
		measurementOptions,
		path: pathFromProps,
		readOnly: readOnlyFromProps,
	} = props
	const { defaultUnit, initialUnit, precision, registryDefault, storageUnit, units, usage } =
		measurementOptions
	const { i18n, t } = useTranslation()
	const locale = i18n.language

	const context = useMeasurementUnits()
	// Standalone fallback when the plugin (and so the provider) is absent
	const [localUnit, setLocalUnit] = useState<UnitId | null>(initialUnit ?? null)
	// navigator is read post-hydration only, or SSR markup would mismatch
	const [localeUnit, setLocaleUnit] = useState<UnitId | null>(null)
	useEffect(() => {
		setLocaleUnit(resolveUnitForLocale(navigator.language, usage))
	}, [usage])

	const preferenceUnit = context
		? (context.units[usage] ?? (context.ready ? null : (initialUnit ?? null)))
		: localUnit
	const displayUnit = resolveDisplayUnit({
		defaultUnit,
		localeUnit,
		preferenceUnit,
		registryDefault,
		units,
	})

	const fmtBound = useCallback(
		(bound: number) => formatMeasurement(bound, { displayUnit, locale, precision, storageUnit }),
		[displayUnit, locale, precision, storageUnit]
	)

	const memoizedValidate = useCallback<Validate<number | null | undefined>>(
		(value, options) => {
			if (typeof value === 'number' && !Number.isNaN(value)) {
				if (typeof min === 'number' && value < min) {
					return t(keys.measurementBelowMin, { min: fmtBound(min) })
				}
				if (typeof max === 'number' && value > max) {
					return t(keys.measurementAboveMax, { max: fmtBound(max) })
				}
			}
			return number(value, {
				...options,
				max: undefined,
				min: undefined,
				name,
				required,
				type: 'number',
			} as Parameters<typeof number>[1])
		},
		[fmtBound, max, min, name, required, t]
	)

	const {
		customComponents: { AfterInput, BeforeInput, Description, Error: ErrorComponent, Label } = {},
		disabled,
		path,
		setValue,
		showError,
		value,
	} = useField<number | null>({ potentiallyStalePath: pathFromProps, validate: memoizedValidate })

	// renderField only maps permissions into the readOnly clientProp; admin.readOnly
	// reaches custom Field components solely via clientField.admin
	const isReadOnly = Boolean(readOnlyFromProps || disabled || readOnlyFromAdmin)

	const numericValue = typeof value === 'number' && !Number.isNaN(value) ? value : null
	const unitOpts = useMemo(
		() => ({ displayUnit, precision, storageUnit }),
		[displayUnit, precision, storageUnit]
	)

	// Payload's server-driven form-state refresh (conditional-logic revalidation on
	// every change) can replace this field's errorMessage with the server's raw,
	// storage-unit message before our own throttled client validate lands. Compute
	// the unit-aware bound message independently and pass it straight to FieldError
	// so display never depends on winning that race.
	const boundsMessage = useMemo(() => {
		if (numericValue === null) return undefined
		if (typeof min === 'number' && numericValue < min) {
			return t(keys.measurementBelowMin, { min: fmtBound(min) })
		}
		if (typeof max === 'number' && numericValue > max) {
			return t(keys.measurementAboveMax, { max: fmtBound(max) })
		}
		return undefined
	}, [numericValue, min, max, fmtBound, t])

	const editingRef = useRef(false)
	const [drafts, setDrafts] = useState<MeasurementDrafts>(() => draftsFor(numericValue, unitOpts))
	useEffect(() => {
		if (!editingRef.current) setDrafts(draftsFor(numericValue, unitOpts))
	}, [numericValue, unitOpts])

	const commit = useCallback(
		(next: MeasurementDrafts) => {
			setDrafts(next)
			setValue(commitDrafts(next, unitOpts))
		},
		[setValue, unitOpts]
	)

	const onDraftChange = useCallback(
		(part: keyof MeasurementDrafts) => (event: React.ChangeEvent<HTMLInputElement>) => {
			editingRef.current = true
			commit({ ...drafts, [part]: event.target.value })
		},
		[commit, drafts]
	)

	const onBlur = useCallback(() => {
		editingRef.current = false
		setDrafts(draftsFor(numericValue, unitOpts))
	}, [numericValue, unitOpts])

	const selectUnit = useCallback(
		(unit: UnitId) => {
			editingRef.current = false
			if (context) context.setUnit(usage, unit)
			else setLocalUnit(unit)
		},
		[context, usage]
	)

	const isCompound = isCompoundUnit(displayUnit)
	const compoundDef = isCompound ? COMPOUNDS[displayUnit] : null
	const inputId = `field-${path?.replace(/\./g, '__')}`
	const styles = useMemo(() => mergeFieldStyles(field), [field])

	return (
		<div
			className={[
				fieldBaseClass,
				baseClass,
				className,
				showError && 'error',
				isReadOnly && 'read-only',
			]
				.filter(Boolean)
				.join(' ')}
			style={styles}
		>
			<RenderCustomComponent
				CustomComponent={Label}
				Fallback={
					<FieldLabel label={label} localized={localized} path={path} required={required} />
				}
			/>
			<div className={`${fieldBaseClass}__wrap`}>
				<RenderCustomComponent
					CustomComponent={ErrorComponent}
					Fallback={<FieldError message={boundsMessage} path={path} showError={showError} />}
				/>
				{BeforeInput}
				<div className={`${baseClass}__container`}>
					{isCompound && compoundDef ? (
						<span className={`${baseClass}__compound`}>
							<input
								className={`${baseClass}__input ${baseClass}__input--compound`}
								id={inputId}
								inputMode="decimal"
								name={path}
								onBlur={onBlur}
								onChange={onDraftChange('primary')}
								readOnly={isReadOnly}
								step="any"
								style={draftWidth(drafts.primary)}
								type="number"
								value={drafts.primary}
							/>
							<span aria-hidden="true" className={`${baseClass}__suffix`}>
								{unitLabel(compoundDef.major, locale, 'short')}
							</span>
							<input
								aria-label={unitLabel(compoundDef.minor, locale, 'long')}
								className={`${baseClass}__input ${baseClass}__input--compound`}
								inputMode="decimal"
								max={compoundDef.ratio - 0.001}
								min={0}
								onBlur={onBlur}
								onChange={onDraftChange('minor')}
								readOnly={isReadOnly}
								step="any"
								style={draftWidth(drafts.minor)}
								type="number"
								value={drafts.minor}
							/>
							<span aria-hidden="true" className={`${baseClass}__suffix`}>
								{unitLabel(compoundDef.minor, locale, 'short')}
							</span>
						</span>
					) : (
						<input
							className={`${baseClass}__input`}
							id={inputId}
							inputMode="decimal"
							name={path}
							onBlur={onBlur}
							onChange={onDraftChange('primary')}
							placeholder={typeof placeholder === 'string' ? placeholder : undefined}
							readOnly={isReadOnly}
							step="any"
							type="number"
							value={drafts.primary}
						/>
					)}
					{units.length > 1 && !isReadOnly ? (
						<Popup
							button={
								<span className={`${baseClass}__unit-badge`}>
									{unitLabel(displayUnit, locale, 'short')}
								</span>
							}
							buttonClassName={`${baseClass}__unit-button`}
							buttonType="custom"
							caret={false}
							className={`${baseClass}__popup`}
							horizontalAlign="right"
							render={({ close }) => (
								<div
									aria-label={t(keys.selectUnit)}
									className={`${baseClass}__unit-panel`}
									role="listbox"
								>
									{units.map((unit) => (
										<button
											aria-selected={unit === displayUnit}
											className={`${baseClass}__unit-option`}
											key={unit}
											onClick={() => {
												selectUnit(unit)
												close()
											}}
											role="option"
											type="button"
										>
											<span>{unitLabel(unit, locale, 'long')}</span>
											<span className={`${baseClass}__unit-symbol`}>
												{unitLabel(unit, locale, 'short')}
											</span>
										</button>
									))}
								</div>
							)}
							size="fit-content"
							verticalAlign="bottom"
						/>
					) : (
						<span className={`${baseClass}__unit-badge ${baseClass}__unit-badge--static`}>
							{unitLabel(displayUnit, locale, 'short')}
						</span>
					)}
				</div>
				{AfterInput}
				<RenderCustomComponent
					CustomComponent={Description}
					Fallback={<FieldDescription description={description} path={path} />}
				/>
			</div>
		</div>
	)
}
