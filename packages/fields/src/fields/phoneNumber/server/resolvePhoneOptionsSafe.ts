import type { Payload } from 'payload'
import { getFieldsRegistry } from '../../../plugin/registry'
import {
	type PhoneClientOptions,
	type ResolvablePhoneFieldOptions,
	resolvePhoneOptions,
} from '../options'

/**
 * Merges the plugin registry's phoneNumber layer with a field's own, degrading to the
 * field-only layer (and logging) when the registry layer is malformed. The field's own
 * options are only ever knowable at build time, and the registry only at request time
 * (the factory runs before the plugin's normalizeRegistry ever sees the config), so this
 * is the one place both are visible together. Shared by validate, the read hook, and the
 * admin client wrapper, so all three resolve the same phone number the same way.
 */
export const resolvePhoneOptionsSafe = (args: {
	fieldOptions: ResolvablePhoneFieldOptions
	payload: Payload
}): PhoneClientOptions => {
	const { fieldOptions, payload } = args
	const registryConfig = getFieldsRegistry(payload.config)?.phoneNumber
	try {
		return resolvePhoneOptions(fieldOptions, registryConfig)
	} catch (error) {
		payload.logger.error({ err: error }, '[fields] phoneNumber registry default is invalid')
		return resolvePhoneOptions(fieldOptions, undefined)
	}
}
