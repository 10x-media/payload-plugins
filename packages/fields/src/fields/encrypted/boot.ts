import type { Payload } from 'payload'
import { resolveKeys } from './crypto/keys'
import { scanEncryptedFields } from './scan'

/**
 * Fail-fast key validation at boot: resolves every distinct KeysConfig used by
 * encrypted fields (plus the default ring when any field falls back to it) so
 * missing secrets, broken providers, and empty material surface as startup
 * errors, not as runtime surprises on first write.
 */
export const validateEncryptedBoot = async (
	payload: Payload,
	pluginKeys?: Parameters<typeof resolveKeys>[0]
): Promise<void> => {
	const configs = new Set<NonNullable<Parameters<typeof resolveKeys>[0]>>()
	if (pluginKeys) {
		configs.add(pluginKeys)
	}
	// The default ring is only reached when a field has no per-field keys AND the
	// plugin declared no keys; ringForRequest resolves marker.keys ?? pluginKeys
	// and falls back to the secret-derived ring only when both are absent.
	let usesDefault = false
	const fieldSets = [
		...payload.config.collections.map((collection) => collection.fields),
		...payload.config.globals.map((global) => global.fields),
	]
	for (const fields of fieldSets) {
		for (const [, marker] of scanEncryptedFields(fields)) {
			if (marker.keys) {
				configs.add(marker.keys)
			} else if (!pluginKeys) {
				usesDefault = true
			}
		}
	}
	await Promise.all([...configs].map((config) => resolveKeys(config, payload.config.secret)))
	if (usesDefault) {
		await resolveKeys(undefined, payload.config.secret)
	}
}
