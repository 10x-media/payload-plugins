import type { Payload } from 'payload'
import { getFieldsRegistry } from '../../../plugin/registry'
import {
	type MeasurementPrecision,
	type PrecisionMode,
	type ResolvedPrecision,
	resolvePrecision,
} from '../engine/precision'

/**
 * Merges the plugin registry's precision layer with a field's own, degrading to
 * the field-only layer (and logging) when the registry layer is malformed. The
 * plugin's init already rejects a bad `measurement.precision` at boot, before any
 * field can run against it; this is the fallback for a config mutated after
 * `fields()` ran, or assembled without the plugin at all.
 */
export const resolvePrecisionSafe = (args: {
	payload: Payload
	fieldPrecision: MeasurementPrecision | PrecisionMode | undefined
}): ResolvedPrecision => {
	const { fieldPrecision, payload } = args
	const registryPrecision = getFieldsRegistry(payload.config)?.measurement?.precision
	try {
		return resolvePrecision([registryPrecision, fieldPrecision])
	} catch (error) {
		payload.logger.error(
			{ err: error },
			'[fields] measurement precision registry default is invalid'
		)
		return resolvePrecision([undefined, fieldPrecision])
	}
}
