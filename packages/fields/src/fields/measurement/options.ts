import type { NumberField } from 'payload'
import type { ScalarUnitId, UnitId } from './engine/units'
import type { MeasurementUsage } from './engine/usages'

/** payload-preferences key holding the flat per-usage unit map. */
export const MEASUREMENT_PREFERENCE_KEY = '10x-fields-measurement'

export type MeasurementUnitsPreference = Partial<Record<MeasurementUsage, UnitId>>

export type MeasurementFieldOptions = {
	/** Preference bucket and unit family. Determines defaults for everything else. */
	usage: MeasurementUsage
	name?: string
	label?: NumberField['label']
	required?: boolean
	localized?: boolean
	index?: boolean
	/** Bounds in the storage unit, enforced by Payload's native number validation. */
	min?: number
	max?: number
	/** Unit the number is stored in. Match existing data to adopt with zero migration. */
	storageUnit?: ScalarUnitId
	/** Curated subset of the usage's selectable display units. */
	units?: UnitId[]
	/** Field-level display fallback for users with no saved preference. Suppresses locale detection. */
	defaultUnit?: UnitId
	/** Per-unit display fraction digits, overriding the engine defaults. */
	precision?: Partial<Record<UnitId, number>>
	overrides?: (args: { field: NumberField }) => NumberField
}

/** Serializable options shipped to both the Field and Cell components. */
export type MeasurementClientOptions = {
	usage: MeasurementUsage
	storageUnit: ScalarUnitId
	units: UnitId[]
	defaultUnit?: UnitId
	precision?: Partial<Record<UnitId, number>>
}

/** What MeasurementFieldServer hands the client after per-request resolution. */
export type MeasurementResolvedClientOptions = MeasurementClientOptions & {
	/** The viewer's saved unit for this usage, read server-side for a flash-free first paint. */
	initialUnit?: UnitId
	/** Plugin-registry default for this usage. */
	registryDefault?: UnitId
}
