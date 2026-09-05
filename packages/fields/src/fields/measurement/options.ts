import type { NumberField } from 'payload'
import type { MeasurementCustomConfig } from './engine/registry'
import type { DimOf, ScalarUnitId, UnitId, UnitOfDimension } from './engine/units'
import type { MeasurementSystem } from './engine/usages'

/** payload-preferences key holding the flat per-bucket unit map. */
export const MEASUREMENT_PREFERENCE_KEY = '10x-fields-measurement'

/** Saved display units, keyed by each field's `preferenceKey`. */
export type MeasurementUnitsPreference = Partial<Record<string, UnitId>>

type CommonFieldOptions<U extends string> = {
	name?: string
	label?: NumberField['label']
	required?: boolean
	localized?: boolean
	index?: boolean
	/** Bounds in the storage unit, enforced by Payload's native number validation. */
	min?: number
	max?: number
	/** Units offered in the unit picker. Defaults to every unit of the storage unit's dimension. */
	units?: readonly U[]
	/** Preference bucket shared with every field using the same key. Defaults to the dimension. */
	preferenceKey?: string
	/** Display fallback for users with no saved preference, ahead of the plugin and locale defaults. */
	fallbackUnit?: U
	/** Locale-system defaults for this field, ahead of the per-dimension table. */
	localeDefaults?: Partial<Record<MeasurementSystem, U>>
	/** Per-unit display fraction digits, overriding the engine defaults. */
	precision?: Partial<Record<U, number>>
	overrides?: (args: { field: NumberField }) => NumberField
}

/**
 * Built-in units only: `units`, `fallbackUnit`, `localeDefaults` and `precision`
 * keys narrow to the storage unit's dimension.
 */
export type MeasurementFieldOptions<S extends ScalarUnitId = ScalarUnitId> = CommonFieldOptions<
	UnitOfDimension<DimOf<S>>
> & {
	/** Unit the number is stored in. Match existing data to adopt with zero migration. */
	storageUnit: S
	custom?: undefined
}

/** Custom units in play: ids are plain strings, so runtime validation carries the narrowing. */
export type MeasurementCustomFieldOptions = CommonFieldOptions<string> & {
	storageUnit: string
	custom: MeasurementCustomConfig
}

export type AnyMeasurementFieldOptions = MeasurementCustomFieldOptions | MeasurementFieldOptions

/** Serializable options shipped to both the Field and Cell components. */
export type MeasurementClientOptions = {
	storageUnit: ScalarUnitId
	units: readonly UnitId[]
	preferenceKey: string
	dimension: string
	localeDefaults?: Partial<Record<MeasurementSystem, UnitId>>
	fallbackUnit?: UnitId
	precision?: Partial<Record<UnitId, number>>
	custom?: MeasurementCustomConfig
}

/** What MeasurementFieldServer hands the client after per-request resolution. */
export type MeasurementResolvedClientOptions = MeasurementClientOptions & {
	/** The viewer's saved unit for this bucket, read server-side for a flash-free first paint. */
	initialUnit?: UnitId
	/** Plugin-registry default for this bucket. */
	registryDefault?: UnitId
}
