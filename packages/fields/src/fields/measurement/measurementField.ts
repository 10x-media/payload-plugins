import type { FieldHook, NumberField, NumberFieldSingleValidation } from 'payload'
import { number } from 'payload/shared'
import { roundTo } from './engine/convert'
import { createEngine, type MeasurementEngine } from './engine/registry'
import { type ScalarUnitId, STORAGE_FRACTION_DIGITS } from './engine/units'
import type {
	AnyMeasurementFieldOptions,
	MeasurementClientOptions,
	MeasurementCustomFieldOptions,
	MeasurementFieldOptions,
} from './options'

const roundStorageHook: FieldHook = ({ value }) => {
	if (typeof value !== 'number' || Number.isNaN(value)) return value
	return roundTo(value, STORAGE_FRACTION_DIGITS)
}

/**
 * Payload coerces string input through parseFloat before validation, and its
 * native number validation lets the resulting NaN through (typeof NaN is
 * 'number'). Mongoose happens to reject NaN at the driver; Postgres stores
 * NaN::numeric, which then sorts above every real value. Guard here, then
 * defer to the native validator (Payload spreads the field into options, so
 * min/max/required behave exactly as the default install).
 */
const validateMeasurement: NumberFieldSingleValidation = (value, options) => {
	if (typeof value === 'number' && Number.isNaN(value)) {
		return options.req.t('validation:enterNumber')
	}
	return number(value, options)
}

const buildEngine = (options: AnyMeasurementFieldOptions, name: string): MeasurementEngine => {
	try {
		return createEngine(options.custom)
	} catch (error) {
		throw new Error(`measurementField(${name}): ${(error as Error).message}`)
	}
}

/** One path segment, so it round-trips through the preferences document untouched. */
const isValidPreferenceKey = (key: string): boolean => key !== '' && !/[\s/]/.test(key)

const assertUnits = (args: {
	engine: MeasurementEngine
	dimension: string
	name: string
	units: readonly string[]
}): void => {
	const { dimension, engine, name, units } = args
	if (units.length === 0) {
		throw new Error(`measurementField(${name}): units is empty, so no unit can be displayed`)
	}
	for (const unit of units) {
		if (!engine.isScalarUnit(unit) && !engine.isCompoundUnit(unit)) {
			throw new Error(`measurementField(${name}): unit "${unit}" is not a known unit`)
		}
		const unitDimension = engine.dimensionOf(unit)
		if (unitDimension !== dimension) {
			throw new Error(
				`measurementField(${name}): unit "${unit}" is ${unitDimension}, but this field stores ${dimension} (dimension mismatch)`
			)
		}
	}
}

const assertPrecision = (args: {
	engine: MeasurementEngine
	dimension: string
	name: string
	precision: Partial<Record<string, number>>
}): void => {
	const { dimension, engine, name, precision } = args
	for (const [unit, digits] of Object.entries(precision)) {
		if (!engine.isScalarUnit(unit) && !engine.isCompoundUnit(unit)) {
			throw new Error(`measurementField(${name}): precision key "${unit}" is not a known unit`)
		}
		if (engine.dimensionOf(unit) !== dimension) {
			throw new Error(
				`measurementField(${name}): precision key "${unit}" is not a unit of ${dimension}`
			)
		}
		// Intl.NumberFormat rejects out-of-range maximumFractionDigits at render
		// time; fail at config time instead.
		if (typeof digits !== 'number' || !Number.isInteger(digits) || digits < 0 || digits > 100) {
			throw new Error(
				`measurementField(${name}): precision for "${unit}" must be an integer between 0 and 100, got ${digits}`
			)
		}
	}
}

/**
 * Number field storing a canonical value in `storageUnit` while each admin user
 * edits and reads in their preferred unit. Spread a preset for a curated bundle,
 * or declare `storageUnit`/`units`/`preferenceKey` directly. Validation is
 * Payload's native number validation plus a NaN guard (min/max in storage units);
 * the client converts at the edges.
 */
export function measurementField<S extends ScalarUnitId>(
	options: MeasurementFieldOptions<S>
): NumberField
export function measurementField(options: MeasurementCustomFieldOptions): NumberField
export function measurementField(options: AnyMeasurementFieldOptions): NumberField {
	const {
		custom,
		fallbackUnit,
		index,
		label,
		localeDefaults,
		localized,
		max,
		min,
		overrides,
		required,
		storageUnit,
	} = options
	// The real field name defaults off the dimension, which needs a valid storage
	// unit; these two checks run before that, so they label themselves by hand.
	const earlyName = options.name ?? options.preferenceKey ?? storageUnit
	const engine = buildEngine(options, earlyName)

	if (!engine.isScalarUnit(storageUnit)) {
		throw new Error(
			engine.isCompoundUnit(storageUnit)
				? `measurementField(${earlyName}): storageUnit "${storageUnit}" is compound; compound units are display-only`
				: `measurementField(${earlyName}): storageUnit "${storageUnit}" is not a known scalar unit`
		)
	}

	const dimension = engine.dimensionOf(storageUnit)
	const preferenceKey = options.preferenceKey ?? dimension
	const name = options.name ?? preferenceKey
	const units = options.units ?? engine.unitsOfDimension(dimension)
	const precision = options.precision

	if (!isValidPreferenceKey(preferenceKey)) {
		throw new Error(
			`measurementField(${name}): preferenceKey "${preferenceKey}" must be a non-empty string with no whitespace or slashes`
		)
	}
	assertUnits({ dimension, engine, name, units })
	if (fallbackUnit !== undefined && !units.includes(fallbackUnit)) {
		throw new Error(
			`measurementField(${name}): fallbackUnit "${fallbackUnit}" is not in this field's units (${units.join(', ')})`
		)
	}
	if (precision !== undefined) assertPrecision({ dimension, engine, name, precision })

	// Custom unit ids are plain strings while the admin components are still typed
	// against the built-in tables. Narrowed once here; the engine-backed client
	// seam that drops the cast lands with the resolution-chain work.
	const measurementOptions = {
		dimension,
		preferenceKey,
		storageUnit,
		units,
		...(localeDefaults !== undefined ? { localeDefaults } : {}),
		...(fallbackUnit !== undefined ? { fallbackUnit } : {}),
		...(precision !== undefined ? { precision } : {}),
		...(custom !== undefined ? { custom } : {}),
	} as MeasurementClientOptions

	const base: NumberField = {
		name,
		type: 'number',
		...(label !== undefined ? { label } : {}),
		...(required !== undefined ? { required } : {}),
		...(localized !== undefined ? { localized } : {}),
		...(index !== undefined ? { index } : {}),
		...(min !== undefined ? { min } : {}),
		...(max !== undefined ? { max } : {}),
		admin: {
			components: {
				Cell: {
					clientProps: { measurementOptions },
					path: '@10x-media/fields/client#MeasurementCell',
				},
				Field: {
					clientProps: { measurementOptions },
					path: '@10x-media/fields/rsc#MeasurementFieldServer',
				},
			},
		},
		hooks: { beforeValidate: [roundStorageHook] },
		validate: validateMeasurement,
	}

	return typeof overrides === 'function' ? overrides({ field: base }) : base
}
