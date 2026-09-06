'use client'
import type { ClientField, DefaultCellComponentProps } from 'payload'
import type React from 'react'
import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from '../../../translations/useTranslation'
import { type MeasurementSystem, systemForLocale } from '../engine/locale'
import { createEngine, defaultEngine } from '../engine/registry'
import type { MeasurementResolvedClientOptions } from '../options'
import { resolveDisplayUnit } from './editModel'
import { useMeasurementUnits } from './MeasurementUnitsProvider'
import './measurementCell.css'

/**
 * `field` and `onClick` are excluded and re-added as optional: the RSC cell only
 * carries the server-sanitized Field (which serializes functions Payload attaches,
 * e.g. hooks/validate), never a ClientField, and no onClick handler crosses the
 * flight boundary. This cell reads neither, so both stay optional rather than forced.
 */
export type MeasurementCellProps = {
	measurementOptions: MeasurementResolvedClientOptions
	field?: ClientField
} & Omit<DefaultCellComponentProps, 'field' | 'onClick'>

export const MeasurementCell: React.FC<MeasurementCellProps> = (props) => {
	const { cellData, measurementOptions } = props
	const {
		custom,
		dimension,
		fallbackUnit,
		localeDefaults,
		precision,
		preferenceKey,
		registryDefault,
		storageUnit,
		units,
	} = measurementOptions
	const { i18n } = useTranslation()
	const context = useMeasurementUnits()
	const engine = useMemo(() => (custom ? createEngine(custom) : defaultEngine), [custom])
	const [system, setSystem] = useState<MeasurementSystem | null>(null)
	// Gated on the provider: plugin-less cells stay on the field default, not the browser locale.
	useEffect(() => {
		if (context) setSystem(systemForLocale(navigator.language))
	}, [context])

	if (typeof cellData !== 'number' || Number.isNaN(cellData)) return null

	const displayUnit = resolveDisplayUnit({
		dimension,
		fallbackUnit,
		localeDefaults,
		preferenceUnit: context?.units[preferenceKey] ?? null,
		registryDefault,
		system,
		units,
	})
	return (
		<span className="fields-measurement-cell">
			{engine.formatMeasurement(cellData, {
				displayUnit,
				locale: i18n.language,
				precision,
				storageUnit,
			})}
		</span>
	)
}
