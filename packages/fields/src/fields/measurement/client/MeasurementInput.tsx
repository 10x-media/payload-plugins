'use client'
import {
	FieldDescription,
	FieldError,
	FieldLabel,
	fieldBaseClass,
	Popup,
	RenderCustomComponent,
} from '@payloadcms/ui'
import type { StaticDescription, StaticLabel } from 'payload'
import type React from 'react'
import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react'
import { keys } from '../../../translations/keys'
import { useTranslation } from '../../../translations/useTranslation'
import { COMPOUNDS, type MeasurementUnitId } from '../engine/units'
import { commitDrafts, type DirtyDrafts, draftsFor, type MeasurementDrafts } from './editModel'
import {
	type MeasurementInputOptions,
	type MeasurementModel,
	useMeasurementModel,
} from './useMeasurementModel'
import './measurementField.css'

const baseClass = 'fields-measurement'

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

/**
 * Props for the form-free measurement input. `value` is the number in
 * `options.storageUnit`, exactly as `measurementField` stores it; the viewer reads and
 * types in their display unit.
 */
export type MeasurementInputProps = {
	value: null | number | undefined
	/** Fires on every edit with the value converted back to the storage unit. */
	onChange: (value: null | number) => void
	options: MeasurementInputOptions
	/** Bounds in the storage unit; a value outside them shows a message in the display unit. */
	min?: number
	max?: number
	/** Names the input (`id`, `name`, label `htmlFor`), as on a native field. */
	path?: string
	label?: StaticLabel
	description?: StaticDescription
	placeholder?: string
	required?: boolean
	localized?: boolean
	readOnly?: boolean
	/** Message shown in the error tooltip. Left unset, the input reports its own bound errors. */
	error?: string
	/** Forces the error state on or off. Left unset, it follows `error` and the bound check. */
	showError?: boolean
	className?: string
	style?: React.CSSProperties
	Label?: React.ReactNode
	Error?: React.ReactNode
	Description?: React.ReactNode
	BeforeInput?: React.ReactNode
	AfterInput?: React.ReactNode
}

type MeasurementInputViewProps = { model: MeasurementModel } & Omit<
	MeasurementInputProps,
	'options'
>

/** The row itself, shared by `MeasurementInput` and the form-bound `MeasurementField`. */
export const MeasurementInputView: React.FC<MeasurementInputViewProps> = (props) => {
	const {
		AfterInput,
		BeforeInput,
		className,
		Description,
		description,
		Error: ErrorComponent,
		error,
		Label,
		label,
		localized,
		max,
		min,
		model,
		onChange,
		path,
		placeholder,
		readOnly,
		required,
		showError: showErrorFromProps,
		style,
		value,
	} = props
	const {
		displayPrecision,
		displayUnit,
		engine,
		fmtBound,
		locale,
		resolvedPrecision,
		selectUnit: selectModelUnit,
		storageUnit,
		units,
	} = model
	const { t } = useTranslation()
	const isReadOnly = Boolean(readOnly)

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
	const errorMessage = error ?? boundsMessage
	const showError = showErrorFromProps ?? errorMessage !== undefined

	const editingRef = useRef(false)
	const [drafts, setDrafts] = useState<MeasurementDrafts>(() => draftsFor(numericValue, draftOpts))
	// The drafts as painted on screen immediately before the current edit, refreshed
	// only at a resync (mount, external value, blur, unit switch) and never per
	// keystroke. A carry-rounded display (182.5 cm storage paints as 6 ft 0 in even
	// though the exact split is 5 ft 11.850394 in) must never be mistaken for the
	// exact stored value, so commits diff the typed value against this baseline
	// rather than against the exact decompose.
	const paintedDraftsRef = useRef<MeasurementDrafts>(drafts)
	// The stored value the painted drafts were derived from, frozen at the same
	// resync points as paintedDraftsRef. A mid-edit commit updates the live value
	// (and so `numericValue`) before the viewer blurs; diffing the next keystroke's
	// delta against that advanced value, instead of this frozen snapshot, would
	// re-apply an already-committed delta on top of itself.
	const paintedStoredRef = useRef<number | null>(numericValue)
	// Which part the viewer has actually typed into since the last resync: an
	// untouched part must commit the value it already holds, never whatever the
	// display-policy draft happens to show for it.
	const [dirty, setDirty] = useState<DirtyDrafts>(CLEAN)
	useEffect(() => {
		if (!editingRef.current) {
			const resynced = draftsFor(numericValue, draftOpts)
			setDrafts(resynced)
			paintedDraftsRef.current = resynced
			paintedStoredRef.current = numericValue
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
			onChange(
				commitDrafts(next, {
					...draftOpts,
					dirty: nextDirty,
					entry: resolvedPrecision.entry,
					paintedDrafts: paintedDraftsRef.current,
					storedValue: paintedStoredRef.current,
				})
			)
		},
		[dirty, drafts, draftOpts, onChange, resolvedPrecision.entry]
	)

	const onBlur = useCallback(() => {
		editingRef.current = false
		const resynced = draftsFor(numericValue, draftOpts)
		setDrafts(resynced)
		paintedDraftsRef.current = resynced
		paintedStoredRef.current = numericValue
		setDirty(CLEAN)
	}, [numericValue, draftOpts])

	const selectUnit = useCallback(
		(unit: MeasurementUnitId) => {
			editingRef.current = false
			setDirty(CLEAN)
			selectModelUnit(unit)
		},
		[selectModelUnit]
	)

	const isCompound = engine.isCompoundUnit(displayUnit)
	const compoundDef = isCompound ? COMPOUNDS[displayUnit] : null
	// Without a path there is no field id to derive, so the label pairs with a generated one
	const generatedId = useId()
	const inputId = path ? `field-${path.replace(/\./g, '__')}` : generatedId

	const primaryInputRef = useRef<HTMLInputElement>(null)
	const minorInputRef = useRef<HTMLInputElement>(null)

	// Dead-space (or the passive unit suffix, e.g. "in") mousedown focuses the nearest
	// input like a native control; preventDefault stops an already-focused input from
	// blurring, so we never steal focus from it. The suffix is never inside the unit
	// trigger button, so this never intercepts opening the unit popup.
	const focusNearestInput = useCallback((event: React.MouseEvent<HTMLElement>) => {
		const target = event.target as HTMLElement
		const isUnitSuffix = target.closest(`.${baseClass}__unit-static`) !== null
		if (target !== event.currentTarget && !isUnitSuffix) return
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
			style={style}
		>
			<RenderCustomComponent
				CustomComponent={Label}
				Fallback={
					<FieldLabel
						htmlFor={path ? undefined : inputId}
						label={label}
						localized={localized}
						path={path}
						required={required}
					/>
				}
			/>
			<div className={`${fieldBaseClass}__wrap`}>
				<RenderCustomComponent
					CustomComponent={ErrorComponent}
					Fallback={<FieldError message={errorMessage} path={path} showError={showError} />}
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
								placeholder={placeholder}
								readOnly={isReadOnly}
								ref={primaryInputRef}
								step="any"
								style={draftWidth(drafts.primary || placeholder || '')}
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
					Fallback={<FieldDescription description={description} path={path ?? ''} />}
				/>
			</div>
		</div>
	)
}

/**
 * The measurement field's row, unit menu and conversion pipeline with no form behind
 * it, for custom admin views and components. Inside the admin the display unit is the
 * viewer's saved preference for `preferenceKey`, shared with every measurement field
 * on that key; `MeasurementField` is this plus `useField`.
 */
export const MeasurementInput: React.FC<MeasurementInputProps> = ({ options, ...props }) => {
	const model = useMeasurementModel(options)
	return <MeasurementInputView model={model} {...props} />
}
