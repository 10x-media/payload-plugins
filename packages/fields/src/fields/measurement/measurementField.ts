import type { FieldHook, NumberField, NumberFieldSingleValidation } from 'payload'
import { number } from 'payload/shared'
import { getFieldsRegistry } from '../../plugin/registry'
import { roundTo } from './engine/convert'
import { type MeasurementPrecision, type PrecisionMode, resolvePrecision } from './engine/precision'
import { createEngine, type MeasurementEngine } from './engine/registry'
import type { ScalarUnitId } from './engine/units'
import {
	type AnyMeasurementFieldOptions,
	MEASUREMENT_CUSTOM_KEY,
	type MeasurementClientOptions,
	type MeasurementCustomFieldOptions,
	type MeasurementFieldOptions,
} from './options'

/**
 * Storage digits may come from the plugin registry, so this resolves per request
 * rather than once at field-build time. `fieldPrecision` is the field's own
 * (unresolved) layer, stamped once when the field was built.
 */
const buildRoundStorageHook = (
	fieldPrecision: MeasurementPrecision | PrecisionMode | undefined
): FieldHook => {
	return ({ req, value }) => {
		if (typeof value !== 'number' || Number.isNaN(value)) return value
		const registryPrecision = getFieldsRegistry(req.payload.config)?.measurement?.precision
		const { storage } = resolvePrecision([registryPrecision, fieldPrecision])
		return roundTo(value, storage)
	}
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

const isPrecisionMode = (mode: unknown): mode is PrecisionMode =>
	mode === 'readable' || mode === 'exact'

/**
 * Validates the field's own (unresolved) precision layer at config time, so a bad
 * value fails fast rather than surfacing later from `resolvePrecision`. Storage
 * range is re-checked there too, once merged with the plugin registry's layer;
 * `display` digits stay factory-only, since only the factory has unit context.
 */
const assertPrecision = (args: {
	engine: MeasurementEngine
	dimension: string
	name: string
	precision: MeasurementPrecision | PrecisionMode
}): void => {
	const { dimension, engine, name, precision } = args
	if (typeof precision === 'string') {
		if (!isPrecisionMode(precision)) {
			throw new Error(
				`measurementField(${name}): precision "${precision}" must be "readable" or "exact"`
			)
		}
		return
	}
	const { display, draft, entry, mode, storage } = precision
	if (mode !== undefined && !isPrecisionMode(mode)) {
		throw new Error(
			`measurementField(${name}): precision.mode "${mode}" must be "readable" or "exact"`
		)
	}
	if (entry !== undefined && entry !== 'quantize' && entry !== 'free') {
		throw new Error(
			`measurementField(${name}): precision.entry "${entry}" must be "quantize" or "free"`
		)
	}
	if (draft !== undefined && draft !== 'display' && draft !== 'faithful') {
		throw new Error(
			`measurementField(${name}): precision.draft "${draft}" must be "display" or "faithful"`
		)
	}
	if (
		storage !== undefined &&
		(typeof storage !== 'number' || !Number.isInteger(storage) || storage < 0 || storage > 12)
	) {
		throw new Error(
			`measurementField(${name}): precision.storage must be an integer between 0 and 12, got ${storage}`
		)
	}
	if (display === undefined) return
	for (const [unit, digits] of Object.entries(display)) {
		if (!engine.isScalarUnit(unit) && !engine.isCompoundUnit(unit)) {
			throw new Error(
				`measurementField(${name}): precision.display key "${unit}" is not a known unit`
			)
		}
		if (engine.dimensionOf(unit) !== dimension) {
			throw new Error(
				`measurementField(${name}): precision.display key "${unit}" is not a unit of ${dimension}`
			)
		}
		// Intl.NumberFormat rejects out-of-range maximumFractionDigits at render
		// time; fail at config time instead.
		if (typeof digits !== 'number' || !Number.isInteger(digits) || digits < 0 || digits > 100) {
			throw new Error(
				`measurementField(${name}): precision.display for "${unit}" must be an integer between 0 and 100, got ${digits}`
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

	const measurementOptions: MeasurementClientOptions = {
		dimension,
		preferenceKey,
		storageUnit,
		units,
		...(localeDefaults !== undefined ? { localeDefaults } : {}),
		...(fallbackUnit !== undefined ? { fallbackUnit } : {}),
		...(precision !== undefined ? { precision } : {}),
		...(custom !== undefined ? { custom } : {}),
	}

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
					path: '@10x-media/fields/rsc#MeasurementCellServer',
				},
				Field: {
					clientProps: { measurementOptions },
					path: '@10x-media/fields/rsc#MeasurementFieldServer',
				},
			},
		},
		custom: { [MEASUREMENT_CUSTOM_KEY]: measurementOptions },
		hooks: { beforeValidate: [buildRoundStorageHook(precision)] },
		validate: validateMeasurement,
	}

	return typeof overrides === 'function' ? overrides({ field: base }) : base
}
