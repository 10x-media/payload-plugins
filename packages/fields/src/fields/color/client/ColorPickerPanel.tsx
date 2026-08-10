'use client'
import type React from 'react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { keys } from '../../../translations/keys'
import { useTranslation } from '../../../translations/useTranslation'
import type { ColorFormat } from '../../../types'
import { formatColor, hsvToRgb } from '../engine'
import type { ResolvedColorPreset } from '../options'
import { swatchBackground } from '../schemeValue'
import { EyedropperIcon } from './icons'

const baseClass = 'fields-color'
const FORMATS: ColorFormat[] = ['hex', 'rgb', 'hsl', 'oklch']

export type Hsva = { a: number; h: number; s: number; v: number }

type EyeDropperConstructor = new () => { open: () => Promise<{ sRGBHex: string }> }

const getEyeDropper = (): EyeDropperConstructor | null => {
	if (typeof window === 'undefined') return null
	return (window as Window & { EyeDropper?: EyeDropperConstructor }).EyeDropper ?? null
}

const clamp01 = (value: number): number => Math.min(1, Math.max(0, value))

export type ColorPickerPanelProps = {
	activePresetKey: null | string
	alphaEnabled: boolean
	close: () => void
	displayFormat: ColorFormat
	enableEyedropper: boolean
	initial: Hsva | null
	onPickCss: (css: string) => void
	onPickPreset: (preset: ResolvedColorPreset) => void
	presetMissing: boolean
	presets: ResolvedColorPreset[]
	presetsLabel: string
	setDisplayFormat: (format: ColorFormat) => void
}

export const ColorPickerPanel: React.FC<ColorPickerPanelProps> = (props) => {
	const {
		activePresetKey,
		alphaEnabled,
		close,
		displayFormat,
		enableEyedropper,
		initial,
		onPickCss,
		onPickPreset,
		presetMissing,
		presets,
		presetsLabel,
		setDisplayFormat,
	} = props
	const { t } = useTranslation()

	const [hsva, setHsva] = useState<Hsva>(initial ?? { a: 1, h: 0, s: 1, v: 1 })
	const hsvaRef = useRef(hsva)
	hsvaRef.current = hsva
	const draggingRef = useRef(false)
	const svRef = useRef<HTMLDivElement>(null)
	const rafRef = useRef<null | number>(null)
	const pendingRef = useRef<Hsva | null>(null)
	const lastEmittedRef = useRef<null | string>(null)

	const initialKey = initial ? `${initial.h}|${initial.s}|${initial.v}|${initial.a}` : ''
	// biome-ignore lint/correctness/useExhaustiveDependencies: resync only when the committed color changes, not on every initial object identity change
	useEffect(() => {
		if (!initial) {
			lastEmittedRef.current = null
			return
		}
		if (draggingRef.current) return
		// Skip echoes of our own commit: achromatic values round-trip with h/s zeroed and would clobber the local hue/saturation.
		// Compared opaque (alpha quantizes through hex storage) and one-shot (a stale ref must not suppress a later genuine match)
		const incomingCss = formatColor(
			hsvToRgb({ h: initial.h, s: initial.s, v: initial.v }, 1),
			'rgb'
		)
		const skip = incomingCss === lastEmittedRef.current
		lastEmittedRef.current = null
		if (skip) return
		setHsva(initial)
	}, [initialKey])

	useEffect(
		() => () => {
			if (rafRef.current !== null) cancelAnimationFrame(rafRef.current)
		},
		[]
	)

	// Commits are rAF-throttled: pointermove floods would otherwise dispatch a form update per event
	const commit = useCallback(
		(next: Hsva) => {
			pendingRef.current = next
			if (rafRef.current !== null) return
			rafRef.current = requestAnimationFrame(() => {
				rafRef.current = null
				const pending = pendingRef.current
				if (!pending) return
				lastEmittedRef.current = formatColor(
					hsvToRgb({ h: pending.h, s: pending.s, v: pending.v }, 1),
					'rgb'
				)
				onPickCss(
					formatColor(
						hsvToRgb({ h: pending.h, s: pending.s, v: pending.v }, alphaEnabled ? pending.a : 1),
						'rgb'
					)
				)
			})
		},
		[alphaEnabled, onPickCss]
	)

	const applyPartial = useCallback(
		(patch: Partial<Hsva>) => {
			const next = { ...hsvaRef.current, ...patch }
			setHsva(next)
			commit(next)
		},
		[commit]
	)

	const svPointer = useCallback(
		(event: React.PointerEvent<HTMLDivElement>) => {
			const rect = svRef.current?.getBoundingClientRect()
			if (!rect) return
			applyPartial({
				s: clamp01((event.clientX - rect.left) / rect.width),
				v: clamp01(1 - (event.clientY - rect.top) / rect.height),
			})
		},
		[applyPartial]
	)

	const onSvKeyDown = useCallback(
		(event: React.KeyboardEvent<HTMLDivElement>) => {
			if (!event.key.startsWith('Arrow')) return
			// Popup preventDefaults ArrowUp/ArrowDown at document level for focus cycling; consume first
			event.stopPropagation()
			event.preventDefault()
			const step = event.shiftKey ? 0.1 : 0.01
			const current = hsvaRef.current
			if (event.key === 'ArrowLeft') applyPartial({ s: clamp01(current.s - step) })
			if (event.key === 'ArrowRight') applyPartial({ s: clamp01(current.s + step) })
			if (event.key === 'ArrowUp') applyPartial({ v: clamp01(current.v + step) })
			if (event.key === 'ArrowDown') applyPartial({ v: clamp01(current.v - step) })
		},
		[applyPartial]
	)

	// Without this the Popup's document keydown handler preventDefaults native range stepping
	const stopArrowKeys = useCallback((event: React.KeyboardEvent) => {
		if (event.key.startsWith('Arrow')) event.stopPropagation()
	}, [])

	// Fires after pointerup AND pointercancel, so an interrupted drag never leaves draggingRef stuck
	const endDrag = useCallback(() => {
		draggingRef.current = false
	}, [])

	const opaqueCss = formatColor(hsvToRgb({ h: hsva.h, s: hsva.s, v: hsva.v }, 1), 'rgb')
	const eyeDropperCtor = enableEyedropper ? getEyeDropper() : null

	return (
		<div className={`${baseClass}__panel`} data-popup-prevent-close>
			<div
				aria-label={t(keys.saturationBrightness)}
				aria-valuemax={100}
				aria-valuemin={0}
				aria-valuenow={Math.round(hsva.v * 100)}
				aria-valuetext={`${Math.round(hsva.s * 100)}% / ${Math.round(hsva.v * 100)}%`}
				className={`${baseClass}__sv`}
				onKeyDown={onSvKeyDown}
				onPointerDown={(event) => {
					draggingRef.current = true
					event.currentTarget.setPointerCapture(event.pointerId)
					svPointer(event)
				}}
				onLostPointerCapture={endDrag}
				onPointerMove={(event) => {
					if (draggingRef.current) svPointer(event)
				}}
				onPointerUp={endDrag}
				ref={svRef}
				role="slider"
				style={{ backgroundColor: `hsl(${Math.round(hsva.h)} 100% 50%)` }}
				tabIndex={0}
			>
				<span
					className={`${baseClass}__sv-thumb`}
					style={{ left: `${hsva.s * 100}%`, top: `${(1 - hsva.v) * 100}%` }}
				/>
			</div>

			<input
				aria-label={t(keys.hue)}
				className={`${baseClass}__slider ${baseClass}__slider--hue`}
				max={360}
				min={0}
				onChange={(event) => applyPartial({ h: Number(event.target.value) })}
				onKeyDown={stopArrowKeys}
				onLostPointerCapture={endDrag}
				step={1}
				type="range"
				value={Math.round(hsva.h)}
			/>

			{alphaEnabled ? (
				<input
					aria-label={t(keys.opacity)}
					className={`${baseClass}__slider ${baseClass}__slider--alpha`}
					max={100}
					min={0}
					onChange={(event) => applyPartial({ a: Number(event.target.value) / 100 })}
					onKeyDown={stopArrowKeys}
					onLostPointerCapture={endDrag}
					step={1}
					style={{
						backgroundImage: `linear-gradient(to right, transparent, ${opaqueCss}), conic-gradient(var(--theme-elevation-150) 0 25%, transparent 0 50%, var(--theme-elevation-150) 0 75%, transparent 0)`,
						backgroundSize: '100% 100%, 8px 8px',
					}}
					type="range"
					value={Math.round(hsva.a * 100)}
				/>
			) : null}

			<div className={`${baseClass}__controls`}>
				{/* biome-ignore lint/a11y/useSemanticElements: fieldset breaks flex layout in Safari; this is a toggle-button group, not a form fieldset */}
				<div aria-label={t(keys.format)} className={`${baseClass}__formats`} role="group">
					{FORMATS.map((entry) => (
						<button
							aria-pressed={entry === displayFormat}
							className={`${baseClass}__format`}
							key={entry}
							onClick={() => setDisplayFormat(entry)}
							type="button"
						>
							{entry}
						</button>
					))}
				</div>
				{eyeDropperCtor ? (
					<button
						aria-label={t(keys.eyedropperPick)}
						className={`${baseClass}__eyedropper`}
						onClick={() => {
							void new eyeDropperCtor().open().then(
								(result) => onPickCss(result.sRGBHex),
								// open() rejects when the user presses Escape; nothing to do
								() => undefined
							)
						}}
						type="button"
					>
						<EyedropperIcon />
					</button>
				) : null}
			</div>

			{presets.length > 0 ? (
				<div className={`${baseClass}__presets`}>
					<div className={`${baseClass}__presets-label`}>{presetsLabel}</div>
					{presetMissing ? (
						<p className={`${baseClass}__missing`}>{t(keys.missingPresetHint)}</p>
					) : null}
					<div className={`${baseClass}__presets-grid`}>
						{presets.map((preset) => (
							<button
								aria-label={preset.label}
								aria-pressed={preset.key === activePresetKey}
								className={`${baseClass}__preset ${baseClass}__checker`}
								key={preset.key}
								onClick={() => {
									onPickPreset(preset)
									close()
								}}
								title={preset.label}
								type="button"
							>
								<span style={{ background: swatchBackground(preset.value) ?? undefined }} />
							</button>
						))}
					</div>
				</div>
			) : null}
		</div>
	)
}
