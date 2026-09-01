import type { FieldHook, NumberField } from 'payload'
import { roundTo } from './engine/convert'
import { isScalarUnit, STORAGE_FRACTION_DIGITS, UNITS, type UnitId } from './engine/units'
import { USAGES } from './engine/usages'
import type { MeasurementClientOptions, MeasurementFieldOptions } from './options'

const roundStorageHook: FieldHook = ({ value }) => {
	if (typeof value !== 'number' || Number.isNaN(value)) return value
	return roundTo(value, STORAGE_FRACTION_DIGITS)
}

/**
 * Number field storing a canonical value in `storageUnit` while each admin user
 * edits and reads in their preferred unit. Validation stays Payload's native
 * number validation (min/max in storage units); the client converts at the edges.
 */
export const measurementField = (options: MeasurementFieldOptions): NumberField => {
	const usageDef = USAGES[options.usage]
	if (!usageDef) {
		throw new Error(`measurementField: unknown usage "${options.usage}"`)
	}
	const {
		defaultUnit,
		index,
		label,
		localized,
		max,
		min,
		name = usageDef.defaultName,
		overrides,
		precision,
		required,
		storageUnit = usageDef.defaultStorageUnit,
		units = usageDef.units,
		usage,
	} = options

	if (!isScalarUnit(storageUnit)) {
		throw new Error(
			`measurementField(${name}): storageUnit "${storageUnit}" is not a scalar unit; compound units are display-only`
		)
	}
	if (UNITS[storageUnit].dimension !== usageDef.dimension) {
		throw new Error(
			`measurementField(${name}): storageUnit "${storageUnit}" is ${UNITS[storageUnit].dimension}, but usage "${usage}" is ${usageDef.dimension} (dimension mismatch)`
		)
	}
	const invalidUnit = units.find((unit: UnitId) => !usageDef.units.includes(unit))
	if (invalidUnit) {
		throw new Error(
			`measurementField(${name}): unit "${invalidUnit}" is not selectable for usage "${usage}" (allowed: ${usageDef.units.join(', ')})`
		)
	}
	if (defaultUnit !== undefined && !units.includes(defaultUnit)) {
		throw new Error(
			`measurementField(${name}): defaultUnit "${defaultUnit}" is not in this field's units (${units.join(', ')})`
		)
	}

	const measurementOptions: MeasurementClientOptions = {
		storageUnit,
		units,
		usage,
		...(defaultUnit !== undefined ? { defaultUnit } : {}),
		...(precision !== undefined ? { precision } : {}),
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
					path: '@10x-media/fields/client#MeasurementCell',
				},
				Field: {
					clientProps: { measurementOptions },
					path: '@10x-media/fields/rsc#MeasurementFieldServer',
				},
			},
		},
		hooks: { beforeValidate: [roundStorageHook] },
	}

	return typeof overrides === 'function' ? overrides({ field: base }) : base
}
