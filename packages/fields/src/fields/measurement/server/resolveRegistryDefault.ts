import type { Payload, PayloadRequest } from 'payload'
import { getFieldsRegistry } from '../../../plugin/registry'
import type { MeasurementUnitId } from '../engine/units'

/**
 * Shared by the edit view (has `req`) and the list cell (does not, per Payload's
 * Cell component props) so both resolve the registry's `defaultUnits` the same
 * way, whether it's a plain map or a per-request resolver function.
 */
export const resolveRegistryDefault = (args: {
	payload: Payload
	preferenceKey: string
	req: PayloadRequest | undefined
}): MeasurementUnitId | undefined => {
	const { payload, preferenceKey, req } = args
	const defaultUnits = getFieldsRegistry(payload.config)?.measurement?.defaultUnits
	if (!defaultUnits) return undefined
	if (typeof defaultUnits === 'function') {
		try {
			return defaultUnits({ preferenceKey, req })
		} catch (error) {
			payload.logger.error({ err: error }, '[fields] measurement defaultUnits resolver failed')
			return undefined
		}
	}
	return defaultUnits[preferenceKey]
}
