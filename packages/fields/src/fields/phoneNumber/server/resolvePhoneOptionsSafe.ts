import type { Payload } from 'payload'
import { getFieldsRegistry } from '../../../plugin/registry'
import { isMetadataSet } from '../engine/metadata'
import {
	type PhoneClientOptions,
	type ResolvablePhoneFieldOptions,
	resolvePhoneOptions,
} from '../options'

/**
 * Merges the plugin registry's phoneNumber layer with a field's own, dropping a `metadata`
 * set the loader cannot carry so the default applies. `normalizeRegistry` rejects one at
 * plugin build time, but a config assembled without the plugin, or mutated after it ran,
 * arrives here unchecked, and `loadMetadata` then rejects in the read hook and in both
 * validators, which have no degrade path: every read and every write of the collection fails.
 *
 * The field's own options are only ever knowable at build time, and the registry only at
 * request time (the factory runs before the plugin's normalizeRegistry ever sees the config),
 * so this is the one place both are visible together. Shared by validate, the read hook, and
 * the admin client wrapper, so all three resolve the same phone number the same way.
 */
export const resolvePhoneOptionsSafe = (args: {
	fieldOptions: ResolvablePhoneFieldOptions
	payload: Payload
}): PhoneClientOptions => {
	const { fieldOptions, payload } = args
	const registryConfig = getFieldsRegistry(payload.config)?.phoneNumber
	// Widened deliberately: the union only holds for a config the plugin actually normalized.
	const declared: string | undefined = registryConfig?.metadata
	if (declared !== undefined && !isMetadataSet(declared)) {
		payload.logger.error(
			{ metadata: declared },
			'[fields] phoneNumber registry metadata is not a set this install can load; falling back to the default'
		)
		return resolvePhoneOptions(fieldOptions, { ...registryConfig, metadata: undefined })
	}
	return resolvePhoneOptions(fieldOptions, registryConfig)
}
