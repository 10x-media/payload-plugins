'use client'
import {
	FieldDescription,
	FieldError,
	FieldLabel,
	fieldBaseClass,
	Popup,
	RenderCustomComponent,
	useField,
	XIcon,
} from '@payloadcms/ui'
import { mergeFieldStyles } from '@payloadcms/ui/shared'
import type { TextFieldClientProps, Validate } from 'payload'
import { text } from 'payload/shared'
import type React from 'react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { keys } from '../../../translations/keys'
import { useTranslation } from '../../../translations/useTranslation'
import type { ColorFormat } from '../../../types'
import { resolveCommitValue } from '../commitValue'
import {
	formatColor,
	isColorSchemeValue,
	parseColor,
	rgbToHsv,
	salvageColor,
	toRgb,
} from '../engine'
import { type ColorFieldClientOptions, PRESET_PREFIX, type ResolvedColorPreset } from '../options'
import { derivePresetChip } from '../presetChip'
import {
	applyReferenceAlpha,
	formatPresetReference,
	parsePresetReference,
	presetReferenceIssue,
	presetReferenceParts,
} from '../presetReference'
import { flatValue, swatchBackground } from '../schemeValue'
import { ColorPickerPanel, type Hsva } from './ColorPickerPanel'
import './colorField.css'

const baseClass = 'fields-color'

export type ColorFieldProps = {
	colorOptions: ColorFieldClientOptions
	presetsLabel?: string
	resolvedPresets?: ResolvedColorPreset[]
} & TextFieldClientProps

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
		resolvedPresets = [],
	} = props
	const { alpha, enableEyedropper, format, isClearable, linked, linkedFallback } = colorOptions
	const { t } = useTranslation()

	const memoizedValidate = useCallback<Validate<string>>(
		(value, options) => {
			if (typeof value === 'string' && value !== '') {
				if (linked && value.startsWith(PRESET_PREFIX)) {
					const hasKey =
						resolvedPresets.length > 0
							? (key: string) => resolvedPresets.some((preset) => preset.key === key)
							: null
					const issue = presetReferenceIssue(value, hasKey)
					if (issue === 'invalidAlpha') return t(keys.invalidColor)
					if (issue !== null) return t(keys.missingPreset)
				} else if (!parseColor(value)) {
					return t(keys.invalidColor)
				}
			}
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

	const stringValue = typeof value === 'string' ? value : ''
	const reference = linked ? parsePresetReference(stringValue) : null
	const presetKey = reference?.key ?? null
	// With alpha disabled a stored suffix still parses, but renders at full
	// opacity so the field matches server resolution until commit strips it
	const referenceAlpha = alpha ? (reference?.alpha ?? 100) : 100
	const activePreset =
		presetKey !== null ? resolvedPresets.find((preset) => preset.key === presetKey) : undefined
	const presetMissing = presetKey !== null && !activePreset
	const rawValue: unknown =
		presetKey !== null ? (activePreset?.value ?? linkedFallback) : stringValue || null
	const cssValue = flatValue(rawValue)
	const parsed = useMemo(() => (cssValue ? parseColor(cssValue) : null), [cssValue])

	const [displayFormat, setDisplayFormat] = useState<ColorFormat>(format)
	const displayValue = useMemo(() => {
		if (presetKey !== null || !parsed || displayFormat === format) return stringValue
		return formatColor(parsed, displayFormat, { alpha })
	}, [alpha, displayFormat, format, parsed, presetKey, stringValue])

	const [draft, setDraft] = useState(displayValue)
	const editingRef = useRef(false)
	useEffect(() => {
		if (!editingRef.current) setDraft(displayValue)
	}, [displayValue])

	// Typing dismisses the chip into plain text entry; blur re-derives it from the committed value
	const [chipDismissed, setChipDismissed] = useState(false)
	const chip = useMemo(
		() =>
			derivePresetChip({
				editing: chipDismissed,
				linked,
				presets: resolvedPresets,
				value: stringValue,
			}),
		[chipDismissed, linked, resolvedPresets, stringValue]
	)

	const debounceRef = useRef<null | ReturnType<typeof setTimeout>>(null)
	useEffect(
		() => () => {
			if (debounceRef.current) clearTimeout(debounceRef.current)
		},
		[]
	)

	// Revert target for non-clearable commits; tracked from committed values so
	// picker commits, preset picks, and the initially loaded value all count
	const lastValidRef = useRef<null | string>(null)
	useEffect(() => {
		if (stringValue === '') return
		if (presetKey ? true : parseColor(stringValue) !== null) lastValidRef.current = stringValue
	}, [presetKey, stringValue])

	// Commits to the form without touching editingRef: the debounced path must not let the draft resync mid-typing.
	// Returns true when a non-clearable empty or unparseable draft was reverted to the last valid value.
	const commitText = useCallback(
		(raw: string): boolean => {
			let normalized: null | string = null
			if (linked && raw.startsWith(PRESET_PREFIX)) {
				const parts = presetReferenceParts(raw)
				// Canonical form: /100 collapses to the bare reference, and a disabled
				// alpha channel strips any hand-typed suffix. Empty keys commit raw so
				// validation surfaces the missing-preset error.
				if (parts) normalized = formatPresetReference(parts.key, alpha ? parts.alpha : 100)
				else if (raw.length > PRESET_PREFIX.length) normalized = raw
			} else {
				const parsedRaw = parseColor(raw)
				// Unparseable input commits raw so validation surfaces the error
				if (parsedRaw) normalized = formatColor(parsedRaw, format, { alpha })
			}
			const resolution = resolveCommitValue({
				draft: raw,
				isClearable,
				lastValid: lastValidRef.current,
				parsed: normalized,
			})
			lastValidRef.current = resolution.lastValid
			setValue(resolution.value)
			return resolution.reverted
		},
		[alpha, format, isClearable, linked, setValue]
	)

	const onTextChange = useCallback(
		(event: React.ChangeEvent<HTMLInputElement>) => {
			const raw = event.target.value
			editingRef.current = true
			setChipDismissed(true)
			setDraft(raw)
			if (debounceRef.current) clearTimeout(debounceRef.current)
			debounceRef.current = setTimeout(() => commitText(raw), 250)
		},
		[commitText]
	)

	const onTextBlur = useCallback(() => {
		if (debounceRef.current) {
			clearTimeout(debounceRef.current)
			debounceRef.current = null
		}
		if (editingRef.current) {
			editingRef.current = false
			// Blur-only salvage: recover the first valid color from dirty input
			// (double pastes, stray junk) before the normal commit pipeline
			const isPresetDraft = linked && draft.startsWith(PRESET_PREFIX)
			const salvaged =
				!isPresetDraft && draft.trim() !== '' && !parseColor(draft) ? salvageColor(draft) : null
			if (commitText(salvaged ?? draft)) {
				// A reverted commit usually leaves the form value unchanged, so the
				// displayValue resync effect never fires; restore the draft here
				setDraft(displayValue)
			} else if (salvaged !== null) {
				// A salvaged commit can store the same value as before (double paste of
				// the current color), which also skips the resync; clean the draft here
				const parsedSalvaged = parseColor(salvaged)
				setDraft(parsedSalvaged ? formatColor(parsedSalvaged, displayFormat, { alpha }) : salvaged)
			}
		}
		setChipDismissed(false)
	}, [alpha, commitText, displayFormat, displayValue, draft, linked])

	// Backspace/Delete on the empty chip input never fires a change event, so clear here
	const onTextKeyDown = useCallback(
		(event: React.KeyboardEvent<HTMLInputElement>) => {
			if (!chip || isReadOnly) return
			if (event.key === 'Backspace' || event.key === 'Delete') {
				event.preventDefault()
				setDraft('')
				if (isClearable) {
					setValue(null)
				} else {
					// Keep the stored ref; the emptied draft reverts or gets replaced at commit
					editingRef.current = true
					setChipDismissed(true)
				}
			}
		},
		[chip, isClearable, isReadOnly, setValue]
	)

	const commitCss = useCallback(
		(css: string) => {
			const parsedCss = parseColor(css)
			if (parsedCss) setValue(formatColor(parsedCss, format, { alpha }))
		},
		[alpha, format, setValue]
	)

	// With a reference active the slider represents the reference alpha, not the
	// resolved color's own channel, so returning it to 100 restores the bare ref
	const initialHsva = useMemo<Hsva | null>(() => {
		if (!parsed) return null
		const rgb = toRgb(parsed)
		const hsv = rgbToHsv(rgb)
		return {
			a: presetKey !== null ? referenceAlpha / 100 : rgb.alpha,
			h: hsv.h,
			s: hsv.s,
			v: hsv.v,
		}
	}, [parsed, presetKey, referenceAlpha])

	const commitReferenceAlpha = useCallback(
		(alpha100: number) => {
			if (presetKey === null) return
			setValue(formatPresetReference(presetKey, alpha100))
		},
		[presetKey, setValue]
	)

	// The fade must track real overflow, not chip presence: the badge always hugs
	// the content run's right edge (the input's flex-grow pushes it there), so an
	// unconditional mask would fade it even in a full-width field with room to spare
	const contentRef = useRef<HTMLDivElement>(null)
	const [contentClipped, setContentClipped] = useState(false)
	const measureClip = useCallback(() => {
		const el = contentRef.current
		// +1 absorbs subpixel rounding between scrollWidth (int) and clientWidth
		if (el) setContentClipped(el.scrollWidth > el.clientWidth + 1)
	}, [])
	// No dependency array on purpose: chip mount and label changes alter
	// scrollWidth without resizing the observed box, so re-measure every render
	useEffect(measureClip)
	useEffect(() => {
		const el = contentRef.current
		if (!el) return
		const observer = new ResizeObserver(measureClip)
		observer.observe(el)
		return () => observer.disconnect()
	}, [measureClip])

	const styles = useMemo(() => mergeFieldStyles(field), [field])
	const swatchValue =
		referenceAlpha !== 100 && (typeof rawValue === 'string' || isColorSchemeValue(rawValue))
			? applyReferenceAlpha(rawValue, referenceAlpha, 'rgb')
			: rawValue
	const swatchCss = swatchBackground(swatchValue)

	const swatch = (
		<span className={`${baseClass}__swatch ${baseClass}__checker`}>
			{swatchCss ? (
				<span className={`${baseClass}__swatch-color`} style={{ background: swatchCss }} />
			) : null}
			{presetMissing && !swatchCss ? (
				<span className={`${baseClass}__swatch-color`} data-missing="true" />
			) : null}
			{isReadOnly ? null : <span className={`${baseClass}__sr-only`}>{t(keys.pickColor)}</span>}
		</span>
	)

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
					Fallback={<FieldError path={path} showError={showError} />}
				/>
				{BeforeInput}
				<div className={`${baseClass}__container`}>
					{isReadOnly ? (
						<span className={`${baseClass}__swatch-button ${baseClass}__swatch-button--static`}>
							{swatch}
						</span>
					) : (
						<Popup
							button={swatch}
							buttonClassName={`${baseClass}__swatch-button`}
							buttonType="custom"
							caret={false}
							className={`${baseClass}__popup`}
							horizontalAlign="left"
							render={({ close }) => (
								<ColorPickerPanel
									activeReference={reference}
									alphaEnabled={alpha}
									close={close}
									displayFormat={displayFormat}
									enableEyedropper={enableEyedropper}
									initial={initialHsva}
									onPickAlpha={commitReferenceAlpha}
									onPickCss={commitCss}
									onPickPreset={(preset) => {
										if (linked) setValue(`${PRESET_PREFIX}${preset.key}`)
										else {
											// A text column holds one color, so a scheme preset stores its light member
											const flat = flatValue(preset.value)
											if (flat) commitCss(flat)
										}
									}}
									presetMissing={presetMissing}
									presets={resolvedPresets}
									presetsLabel={presetsLabel ?? t(keys.presets)}
									setDisplayFormat={setDisplayFormat}
								/>
							)}
							size="fit-content"
							verticalAlign="bottom"
						/>
					)}
					<div
						className={[`${baseClass}__content`, contentClipped && `${baseClass}__content--fade`]
							.filter(Boolean)
							.join(' ')}
						ref={contentRef}
					>
						{chip ? (
							<span className={`${baseClass}__chip`}>
								<span className={`${baseClass}__chip-swatch ${baseClass}__checker`}>
									{swatchCss ? (
										<span
											className={`${baseClass}__chip-color`}
											style={{ background: swatchCss }}
										/>
									) : null}
									{chip.missing && !swatchCss ? (
										<span className={`${baseClass}__chip-color`} data-missing="true" />
									) : null}
								</span>
								<span className={`${baseClass}__chip-label`}>{chip.label}</span>
								{alpha && chip.alpha !== 100 ? (
									<span className={`${baseClass}__chip-alpha`}>{chip.alpha}%</span>
								) : null}
							</span>
						) : null}
						<input
							className={`${baseClass}__input`}
							id={`field-${path?.replace(/\./g, '__')}`}
							name={path}
							onBlur={onTextBlur}
							onChange={onTextChange}
							onKeyDown={onTextKeyDown}
							placeholder={chip || typeof placeholder !== 'string' ? undefined : placeholder}
							readOnly={isReadOnly}
							type="text"
							value={chip ? '' : draft}
						/>
						<span aria-hidden="true" className={`${baseClass}__badge`}>
							{chip ? t(keys.preset) : displayFormat}
						</span>
					</div>
					{isClearable && !required && !isReadOnly && stringValue !== '' ? (
						<button
							aria-label={t(keys.clearColor)}
							className={`${baseClass}__clear`}
							onClick={() => {
								setDraft('')
								setValue(null)
							}}
							type="button"
						>
							<XIcon />
						</button>
					) : null}
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
