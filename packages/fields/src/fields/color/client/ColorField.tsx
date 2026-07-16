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
import type { TextFieldClientProps, Validate } from 'payload'
import { text } from 'payload/shared'
import type React from 'react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { keys } from '../../../translations/keys'
import { useTranslation } from '../../../translations/useTranslation'
import type { ColorFormat } from '../../../types'
import { formatColor, parseColor, rgbToHsv, toRgb } from '../engine'
import { type ColorFieldClientOptions, PRESET_PREFIX, type ResolvedColorPreset } from '../options'
import { ColorPickerPanel, type Hsva } from './ColorPickerPanel'
import { ClearIcon } from './icons'
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
			admin: { className, description, placeholder } = {},
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
	const { alpha, enableEyedropper, format, linked, linkedFallback } = colorOptions
	const { t } = useTranslation()

	const memoizedValidate = useCallback<Validate<string>>(
		(value, options) => {
			if (
				typeof value === 'string' &&
				value !== '' &&
				!(linked && value.startsWith(PRESET_PREFIX)) &&
				!parseColor(value)
			) {
				return t(keys.invalidColor)
			}
			return text(value, { ...options, name, required, type: 'text' })
		},
		[linked, name, required, t]
	)

	const {
		customComponents: { AfterInput, BeforeInput, Description, Error: ErrorComponent, Label } = {},
		disabled,
		path,
		setValue,
		showError,
		value,
	} = useField<string>({ potentiallyStalePath: pathFromProps, validate: memoizedValidate })

	const isReadOnly = Boolean(readOnlyFromProps || disabled)

	const stringValue = typeof value === 'string' ? value : ''
	const presetKey =
		linked && stringValue.startsWith(PRESET_PREFIX) ? stringValue.slice(PRESET_PREFIX.length) : null
	const activePreset =
		presetKey !== null ? resolvedPresets.find((preset) => preset.key === presetKey) : undefined
	const presetMissing = presetKey !== null && !activePreset
	const cssValue =
		presetKey !== null ? (activePreset?.value ?? linkedFallback) : stringValue || null
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

	const debounceRef = useRef<null | ReturnType<typeof setTimeout>>(null)
	useEffect(
		() => () => {
			if (debounceRef.current) clearTimeout(debounceRef.current)
		},
		[]
	)

	const commitText = useCallback(
		(raw: string) => {
			editingRef.current = false
			if (raw.trim() === '') {
				setValue(null)
				return
			}
			if (linked && raw.startsWith(PRESET_PREFIX)) {
				setValue(raw)
				return
			}
			const parsedRaw = parseColor(raw)
			// Unparseable input commits raw so validation surfaces the error
			setValue(parsedRaw ? formatColor(parsedRaw, format, { alpha }) : raw)
		},
		[alpha, format, linked, setValue]
	)

	const onTextChange = useCallback(
		(event: React.ChangeEvent<HTMLInputElement>) => {
			const raw = event.target.value
			editingRef.current = true
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
		if (editingRef.current) commitText(draft)
	}, [commitText, draft])

	const commitCss = useCallback(
		(css: string) => {
			const parsedCss = parseColor(css)
			if (parsedCss) setValue(formatColor(parsedCss, format, { alpha }))
		},
		[alpha, format, setValue]
	)

	const initialHsva = useMemo<Hsva | null>(() => {
		if (!parsed) return null
		const rgb = toRgb(parsed)
		const hsv = rgbToHsv(rgb)
		return { a: rgb.alpha, h: hsv.h, s: hsv.s, v: hsv.v }
	}, [parsed])

	const styles = useMemo(() => mergeFieldStyles(field), [field])
	const swatchCss = parsed ? formatColor(parsed, 'rgb') : null

	const swatch = (
		<span className={`${baseClass}__swatch ${baseClass}__checker`}>
			{swatchCss ? (
				<span className={`${baseClass}__swatch-color`} style={{ background: swatchCss }} />
			) : null}
			{presetMissing && !swatchCss ? (
				<span className={`${baseClass}__swatch-color`} data-missing="true" />
			) : null}
			<span className={`${baseClass}__sr-only`}>{t(keys.pickColor)}</span>
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
				<div className={`${baseClass}__row`}>
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
									activePresetKey={activePreset?.key ?? null}
									alphaEnabled={alpha}
									close={close}
									displayFormat={displayFormat}
									enableEyedropper={enableEyedropper}
									initial={initialHsva}
									onPickCss={commitCss}
									onPickPreset={(preset) => {
										if (linked) setValue(`${PRESET_PREFIX}${preset.key}`)
										else commitCss(preset.value)
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
					<input
						className={`${baseClass}__input`}
						disabled={isReadOnly}
						id={`field-${path?.replace(/\./g, '__')}`}
						name={path}
						onBlur={onTextBlur}
						onChange={onTextChange}
						placeholder={typeof placeholder === 'string' ? placeholder : undefined}
						type="text"
						value={draft}
					/>
					<span aria-hidden="true" className={`${baseClass}__chip`}>
						{displayFormat}
					</span>
					{!required && !isReadOnly && stringValue !== '' ? (
						<button
							aria-label={t(keys.clearColor)}
							className={`${baseClass}__clear`}
							onClick={() => {
								setDraft('')
								setValue(null)
							}}
							type="button"
						>
							<ClearIcon />
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
