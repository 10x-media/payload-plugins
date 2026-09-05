'use client'
import type { DefaultCellComponentProps } from 'payload'
import type React from 'react'
import { useEffect, useState } from 'react'
import { useTranslation } from '../../../translations/useTranslation'
import { formatMeasurement } from '../engine/format'
import type { UnitId } from '../engine/units'
import { localeDefaultUnit } from '../engine/usages'
import type { MeasurementClientOptions } from '../options'
import { resolveDisplayUnit } from './editModel'
import { useMeasurementUnits } from './MeasurementUnitsProvider'
import './measurementCell.css'

export type MeasurementCellProps = {
	measurementOptions: MeasurementClientOptions
} & DefaultCellComponentProps

export const MeasurementCell: React.FC<MeasurementCellProps> = (props) => {
	const { cellData, measurementOptions } = props
	const { dimension, fallbackUnit, localeDefaults, precision, preferenceKey, storageUnit, units } =
		measurementOptions
	const { i18n } = useTranslation()
	const context = useMeasurementUnits()
	const [localeUnit, setLocaleUnit] = useState<UnitId | null>(null)
	// Gated on the provider: plugin-less cells stay on the field default, not the browser locale.
	useEffect(() => {
		if (context)
			setLocaleUnit(localeDefaultUnit({ dimension, locale: navigator.language, localeDefaults }))
	}, [context, dimension, localeDefaults])

	if (typeof cellData !== 'number' || Number.isNaN(cellData)) return null

	const displayUnit = resolveDisplayUnit({
		fallbackUnit,
		localeUnit,
		preferenceUnit: context?.units[preferenceKey] ?? null,
		units,
	})
	return (
		<span className="fields-measurement-cell">
			{formatMeasurement(cellData, { displayUnit, locale: i18n.language, precision, storageUnit })}
		</span>
	)
}
