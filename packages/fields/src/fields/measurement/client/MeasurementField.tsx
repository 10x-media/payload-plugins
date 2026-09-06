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
import { type MeasurementSystem, systemForLocale } from '../engine/locale'
import { exactModePrecisionOverride, resolvePrecision } from '../engine/precision'
import { createEngine, defaultEngine } from '../engine/registry'
import { COMPOUNDS, type MeasurementUnitId } from '../engine/units'
import type { MeasurementResolvedClientOptions } from '../options'
import {
	commitDrafts,
	type DirtyDrafts,
	draftsFor,
	type MeasurementDrafts,
	resolveDisplayUnit,
} from './editModel'
import { useMeasurementUnits } from './MeasurementUnitsProvider'
import './measurementField.css'

const baseClass = 'fields-measurement'

/** MeasurementFieldServer always resolves and threads precision; this only covers a hand-authored Field with no server wrapper. */
const DEFAULT_PRECISION = resolvePrecision([])

const CLEAN: DirtyDrafts = { minor: false, primary: false }

/**
 * Every value input sizes to its content so "5 ft 11 in" (or a lone scalar)
 * reads as one left-aligned phrase. The half-ch keeps the caret off the edge;
 * the clamp keeps an empty input clickable and a runaway draft from pushing
 * the row into overflow.
 */
const draftWidth = (draft: string): React.CSSProperties => ({
	width: `${Math.min(Math.max(draft.length, 2), 12) + 0.5}ch`,
})

const unitKebab = (
	<svg
		aria-hidden="true"
		className={`${baseClass}__kebab`}
		focusable="false"
		viewBox="0 0 4 16"
		xmlns="http://www.w3.org/2000/svg"
	>
		<circle cx="2" cy="2" fill="currentColor" r="1.6" />
		<circle cx="2" cy="8" fill="currentColor" r="1.6" />
		<circle cx="2" cy="14" fill="currentColor" r="1.6" />
	</svg>
)

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
	const {
		custom,
		dimension,
		fallbackUnit,
		initialUnit,
		localeDefaults,
		precision,
		preferenceKey,
		registryDefault,
		storageUnit,
		units,
	} = measurementOptions
	const { i18n, t } = useTranslation()
	const locale = i18n.language

	// Every conversion, label and precision lookup runs through this, so the
	// field's custom units behave exactly like the built-in ones.
	const engine = useMemo(() => (custom ? createEngine(custom) : defaultEngine), [custom])

	const context = useMeasurementUnits()
	// Standalone fallback when the plugin (and so the provider) is absent
	const [localUnit, setLocalUnit] = useState<MeasurementUnitId | null>(initialUnit ?? null)
	// navigator is read post-hydration only, or SSR markup would mismatch
	const [system, setSystem] = useState<MeasurementSystem | null>(null)
	useEffect(() => {
		setSystem(systemForLocale(navigator.language))
	}, [])

	const preferenceUnit = context
		? (context.units[preferenceKey] ?? (context.ready ? null : (initialUnit ?? null)))
		: localUnit
	const displayUnit = resolveDisplayUnit({
		dimension,
		fallbackUnit,
		localeDefaults,
		preferenceUnit,
		registryDefault,
		system,
		units,
	})

	const resolvedPrecision = precision ?? DEFAULT_PRECISION
	// Bound messages sit next to a type=number input, which always renders Latin
	// digits; force the same numerals here so "min 5" and "5" agree in RTL/native-digit
	// locales (Arabic, Persian). The input itself stays native-digit for display. Exact
	// mode uses the same storage-digit override as the cell, so error text and cell
	// text always agree.
	const displayPrecision = exactModePrecisionOverride(resolvedPrecision, displayUnit)
	const fmtBound = useCallback(
		(bound: number) => {
			try {
				return engine.formatMeasurement(bound, {
					displayUnit,
					locale: `${locale}-u-nu-latn`,
					precision: displayPrecision,
					storageUnit,
				})
			} catch {
				return engine.formatMeasurement(bound, {
					displayUnit,
					locale,
					precision: displayPrecision,
					storageUnit,
				})
			}
		},
		[displayUnit, engine, locale, displayPrecision, storageUnit]
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
	const draftOpts = useMemo(
		() => ({
			displayUnit,
			draft: resolvedPrecision.draft,
			engine,
			precision: displayPrecision,
			storageDigits: resolvedPrecision.storage,
			storageUnit,
		}),
		[displayUnit, engine, displayPrecision, resolvedPrecision, storageUnit]
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
	const [drafts, setDrafts] = useState<MeasurementDrafts>(() => draftsFor(numericValue, draftOpts))
	// The drafts as painted on screen immediately before the current edit, refreshed
	// only at a resync (mount, external value, blur, unit switch) and never per
	// keystroke. A carry-rounded display (182.5 cm storage paints as 6 ft 0 in even
	// though the exact split is 5 ft 11.850394 in) must never be mistaken for the
	// exact stored value, so commits diff the typed value against this baseline
	// rather than against the exact decompose.
	const paintedDraftsRef = useRef<MeasurementDrafts>(drafts)
	// Which part the viewer has actually typed into since the last resync: an
	// untouched part must commit the value it already holds, never whatever the
	// display-policy draft happens to show for it.
	const [dirty, setDirty] = useState<DirtyDrafts>(CLEAN)
	useEffect(() => {
		if (!editingRef.current) {
			const resynced = draftsFor(numericValue, draftOpts)
			setDrafts(resynced)
			paintedDraftsRef.current = resynced
			setDirty(CLEAN)
		}
	}, [numericValue, draftOpts])

	const onDraftChange = useCallback(
		(part: keyof MeasurementDrafts) => (event: React.ChangeEvent<HTMLInputElement>) => {
			editingRef.current = true
			const next = { ...drafts, [part]: event.target.value }
			const nextDirty = { ...dirty, [part]: true }
			setDrafts(next)
			setDirty(nextDirty)
			setValue(
				commitDrafts(next, {
					...draftOpts,
					dirty: nextDirty,
					entry: resolvedPrecision.entry,
					paintedDrafts: paintedDraftsRef.current,
					storedValue: numericValue,
				})
			)
		},
		[dirty, drafts, draftOpts, numericValue, resolvedPrecision.entry, setValue]
	)

	const onBlur = useCallback(() => {
		editingRef.current = false
		const resynced = draftsFor(numericValue, draftOpts)
		setDrafts(resynced)
		paintedDraftsRef.current = resynced
		setDirty(CLEAN)
	}, [numericValue, draftOpts])

	const selectUnit = useCallback(
		(unit: MeasurementUnitId) => {
			editingRef.current = false
			setDirty(CLEAN)
			if (context) context.setUnit(preferenceKey, unit)
			else setLocalUnit(unit)
		},
		[context, preferenceKey]
	)

	const isCompound = engine.isCompoundUnit(displayUnit)
	const compoundDef = isCompound ? COMPOUNDS[displayUnit] : null
	const inputId = `field-${path?.replace(/\./g, '__')}`
	const styles = useMemo(() => mergeFieldStyles(field), [field])

	const primaryInputRef = useRef<HTMLInputElement>(null)
	const minorInputRef = useRef<HTMLInputElement>(null)

	// Dead-space mousedown focuses the nearest input like a native control; preventDefault
	// stops an already-focused input from blurring, so we never steal focus from it.
	const focusNearestInput = useCallback((event: React.MouseEvent<HTMLElement>) => {
		if (event.target !== event.currentTarget) return
		event.preventDefault()
		const active = document.activeElement
		if (active === primaryInputRef.current || active === minorInputRef.current) return
		const inputs = [primaryInputRef.current, minorInputRef.current].filter(
			(input): input is HTMLInputElement => input !== null
		)
		const [first, ...rest] = inputs
		if (!first) return
		const distanceFrom = (input: HTMLInputElement) => {
			const rect = input.getBoundingClientRect()
			return Math.abs(event.clientX - (rect.left + rect.width / 2))
		}
		let nearest = first
		let nearestDistance = distanceFrom(first)
		for (const input of rest) {
			const distance = distanceFrom(input)
			if (distance < nearestDistance) {
				nearestDistance = distance
				nearest = input
			}
		}
		nearest.focus()
	}, [])

	const isUnitInteractive = units.length > 1 && !isReadOnly
	const placeholderText = typeof placeholder === 'string' ? placeholder : undefined

	const renderUnitPanel = ({ close }: { close: () => void }) => (
		<div aria-label={t(keys.selectUnit)} className={`${baseClass}__unit-panel`} role="listbox">
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
					<span>{engine.unitLabel(unit, locale, 'long')}</span>
					<span className={`${baseClass}__unit-symbol`}>
						{engine.unitLabel(unit, locale, 'short')}
					</span>
				</button>
			))}
		</div>
	)

	const renderUnitSuffix = (unit: MeasurementUnitId) => (
		<span className={`${baseClass}__unit-static`}>{engine.unitLabel(unit, locale, 'short')}</span>
	)

	// One kebab per field, pinned to the row's right edge; the unit text itself
	// stays a passive suffix so value and unit read as a single phrase.
	const renderMenuTrigger = () => {
		if (!isUnitInteractive) return null
		const shortLabel = engine.unitLabel(displayUnit, locale, 'short')
		return (
			<Popup
				button={
					<>
						{unitKebab}
						<span className={`${baseClass}__sr-only`}>
							{t(keys.selectUnit)}: {shortLabel}
						</span>
					</>
				}
				buttonClassName={`${baseClass}__unit-trigger`}
				buttonType="default"
				caret={false}
				className={`${baseClass}__popup`}
				horizontalAlign="right"
				render={renderUnitPanel}
				size="fit-content"
				verticalAlign="bottom"
			/>
		)
	}

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
				{/* biome-ignore lint/a11y/noStaticElementInteractions: mousedown only refocuses an inner input, it adds no control and changes no semantics */}
				<div className={`${baseClass}__container`} onMouseDown={focusNearestInput}>
					{isCompound && compoundDef ? (
						// biome-ignore lint/a11y/noStaticElementInteractions: same as the container, refocuses whichever inner input is nearest
						<span className={`${baseClass}__compound`} onMouseDown={focusNearestInput}>
							<span className={`${baseClass}__part`}>
								<input
									className={`${baseClass}__input`}
									id={inputId}
									inputMode="decimal"
									name={path}
									onBlur={onBlur}
									onChange={onDraftChange('primary')}
									readOnly={isReadOnly}
									ref={primaryInputRef}
									step="any"
									style={draftWidth(drafts.primary)}
									type="number"
									value={drafts.primary}
								/>
								{renderUnitSuffix(compoundDef.major)}
							</span>
							<span className={`${baseClass}__part`}>
								<input
									aria-label={engine.unitLabel(compoundDef.minor, locale, 'long')}
									className={`${baseClass}__input`}
									inputMode="decimal"
									max={compoundDef.ratio - 0.001}
									min={0}
									onBlur={onBlur}
									onChange={onDraftChange('minor')}
									readOnly={isReadOnly}
									ref={minorInputRef}
									step="any"
									style={draftWidth(drafts.minor)}
									type="number"
									value={drafts.minor}
								/>
								{renderUnitSuffix(compoundDef.minor)}
							</span>
						</span>
					) : (
						<>
							<input
								className={`${baseClass}__input`}
								id={inputId}
								inputMode="decimal"
								name={path}
								onBlur={onBlur}
								onChange={onDraftChange('primary')}
								placeholder={placeholderText}
								readOnly={isReadOnly}
								ref={primaryInputRef}
								step="any"
								style={draftWidth(drafts.primary || placeholderText || '')}
								type="number"
								value={drafts.primary}
							/>
							{renderUnitSuffix(displayUnit)}
						</>
					)}
					{renderMenuTrigger()}
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
