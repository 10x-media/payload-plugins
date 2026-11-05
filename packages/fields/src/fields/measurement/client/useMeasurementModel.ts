'use client'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from '../../../translations/useTranslation'
import { type MeasurementSystem, systemForLocale } from '../engine/locale'
import {
	exactModePrecisionOverride,
	type MeasurementPrecision,
	type PrecisionMode,
	resolvePrecision,
} from '../engine/precision'
import { createEngine, defaultEngine } from '../engine/registry'
import type { MeasurementUnitId } from '../engine/units'
import type { MeasurementResolvedClientOptions } from '../options'
import { resolveDisplayUnit } from './editModel'
import { useMeasurementUnits } from './MeasurementUnitsProvider'

/**
 * What the standalone input needs to know about a measurement. Only `storageUnit` is
 * required: `dimension`, `preferenceKey` and `units` default the way `measurementField`
 * defaults them, and `precision` is merged the way the field merges its own layer.
 */
export type MeasurementInputOptions = Omit<
	MeasurementResolvedClientOptions,
	'dimension' | 'precision' | 'preferenceKey' | 'units'
> & {
	dimension?: string
	precision?: MeasurementPrecision | PrecisionMode
	preferenceKey?: string
	units?: readonly MeasurementUnitId[]
}

/**
 * Engine, display unit and precision for one measurement row. Options are compared by
 * content, so a caller passing an inline object does not rebuild the engine and the
 * draft options every render (which would resync drafts in a loop).
 */
export const useMeasurementModel = (options: MeasurementInputOptions) => {
	const optionsKey = JSON.stringify(options)
	const stable = useMemo<MeasurementInputOptions>(() => JSON.parse(optionsKey), [optionsKey])
	const { custom, fallbackUnit, initialUnit, localeDefaults, registryDefault, storageUnit } = stable
	const { i18n } = useTranslation()
	const locale = i18n.language

	// Every conversion, label and precision lookup runs through this, so the
	// field's custom units behave exactly like the built-in ones.
	const engine = useMemo(() => (custom ? createEngine(custom) : defaultEngine), [custom])
	const dimension = stable.dimension ?? engine.dimensionOf(storageUnit)
	const preferenceKey = stable.preferenceKey ?? dimension
	const units = useMemo(
		() => stable.units ?? engine.unitsOfDimension(dimension),
		[dimension, engine, stable.units]
	)
	const resolvedPrecision = useMemo(() => resolvePrecision([stable.precision]), [stable.precision])

	const context = useMeasurementUnits()
	// Session-only fallback when the plugin (and so the provider) is absent
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

	// Bound messages sit next to a type=number input, which always renders Latin
	// digits; force the same numerals here so "min 5" and "5" agree in RTL/native-digit
	// locales (Arabic, Persian). The input itself stays native-digit for display. Exact
	// mode uses the same storage-digit override as the cell, so error text and cell
	// text always agree. Memoized: exact mode builds a fresh object every call, and an
	// unmemoized value here fed draftOpts -> the resync effect -> setDrafts in a loop
	// that never settled.
	const displayPrecision = useMemo(
		() => exactModePrecisionOverride(resolvedPrecision, displayUnit),
		[resolvedPrecision, displayUnit]
	)
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

	const selectUnit = useCallback(
		(unit: MeasurementUnitId) => {
			if (context) context.setUnit(preferenceKey, unit)
			else setLocalUnit(unit)
		},
		[context, preferenceKey]
	)

	return {
		displayPrecision,
		displayUnit,
		engine,
		fmtBound,
		locale,
		resolvedPrecision,
		selectUnit,
		storageUnit,
		units,
	}
}

export type MeasurementModel = ReturnType<typeof useMeasurementModel>
