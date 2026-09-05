'use client'
import { usePreferences } from '@payloadcms/ui'
import type React from 'react'
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import type { MeasurementUnitId } from '../engine/units'
import { MEASUREMENT_PREFERENCE_KEY, type MeasurementUnitsPreference } from '../options'

export type MeasurementUnitsContextValue = {
	ready: boolean
	units: MeasurementUnitsPreference
	setUnit: (preferenceKey: string, unit: MeasurementUnitId) => void
}

const Context = createContext<MeasurementUnitsContextValue | null>(null)

const isPreference = (value: unknown): value is MeasurementUnitsPreference =>
	typeof value === 'object' && value !== null && !Array.isArray(value)

/**
 * Reactive layer over payload-preferences for the per-bucket display units.
 * Payload's own usePreferences is ref-backed and never re-renders consumers,
 * so this provider holds the map in state: one toggle re-renders every
 * measurement field and cell on the page, then persists with merge mode.
 */
export const MeasurementUnitsProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
	const { getPreference, setPreference } = usePreferences()
	const [units, setUnits] = useState<MeasurementUnitsPreference>({})
	const [ready, setReady] = useState(false)

	useEffect(() => {
		let cancelled = false
		getPreference<MeasurementUnitsPreference | null>(MEASUREMENT_PREFERENCE_KEY)
			.then((stored) => {
				if (cancelled) return
				// Toggles made before the fetch resolves win over the stored snapshot
				if (isPreference(stored)) setUnits((current) => ({ ...stored, ...current }))
				setReady(true)
			})
			.catch(() => {
				if (!cancelled) setReady(true)
			})
		return () => {
			cancelled = true
		}
	}, [getPreference])

	const setUnit = useCallback(
		(preferenceKey: string, unit: MeasurementUnitId) => {
			setUnits((current) => ({ ...current, [preferenceKey]: unit }))
			void setPreference(MEASUREMENT_PREFERENCE_KEY, { [preferenceKey]: unit }, true)
		},
		[setPreference]
	)

	const value = useMemo(() => ({ ready, setUnit, units }), [ready, setUnit, units])
	return <Context.Provider value={value}>{children}</Context.Provider>
}

export const useMeasurementUnits = (): MeasurementUnitsContextValue | null => useContext(Context)
