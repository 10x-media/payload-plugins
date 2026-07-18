import { hkdfSync } from 'node:crypto'
import type { KeysConfig } from '../../../types'

/**
 * Domain-separated HKDF-SHA256 derivation. The salt and info strings are part
 * of the wire compatibility surface: changing any of them re-keys every
 * deployment, so they are versioned (v1) and never derived from user input.
 * Deliberately NOT Payload's internal sha256-slice API-key derivation.
 */
const HKDF_SALT = '@10x-media/fields/encrypted'
const INFO_DATA = '10x-fields/encrypted/v1/data'
const INFO_BIDX = '10x-fields/encrypted/v1/bidx'
const KEY_LENGTH = 32

/** Key ids are embedded in the dot-delimited wire format, so dots are banned. */
const KEY_ID_PATTERN = /^[A-Za-z0-9_-]+$/

/** Key id used by the zero-config ring derived from the Payload secret. */
export const DEFAULT_KEY_ID = 'k0'

/** Thrown at config build or boot when key material is missing or malformed. */
export class InvalidKeysConfigError extends Error {
	constructor(message: string) {
		super(`@10x-media/fields: invalid encrypted keys config: ${message}`)
		this.name = 'InvalidKeysConfigError'
	}
}

export interface KeyRing {
	activeId: string
	/** 32-byte AES-256-GCM keys by key id; every configured key can decrypt. */
	dataKeys: Map<string, Buffer>
	/** HMAC key for blind indexes, derived from the active key's material. */
	indexKey: Buffer
}

const hkdf = (ikm: Uint8Array | string, info: string): Buffer =>
	Buffer.from(
		hkdfSync(
			'sha256',
			typeof ikm === 'string' ? Buffer.from(ikm, 'utf8') : ikm,
			Buffer.from(HKDF_SALT, 'utf8'),
			Buffer.from(info, 'utf8'),
			KEY_LENGTH
		)
	)

/**
 * Synchronous shape validation for a KeysConfig. Called by the factory at
 * config-build time so misconfiguration fails before the app boots, not on
 * first write.
 */
export const validateKeysConfig = (config: KeysConfig): void => {
	const ids = Object.keys(config.keys)
	if (ids.length === 0) {
		throw new InvalidKeysConfigError('keys map is empty')
	}
	if (!(config.active in config.keys)) {
		throw new InvalidKeysConfigError(`active key '${config.active}' is not present in the keys map`)
	}
	for (const id of ids) {
		if (!KEY_ID_PATTERN.test(id)) {
			throw new InvalidKeysConfigError(
				`key id '${id}' must match ${String(KEY_ID_PATTERN)} (it is embedded in the wire format)`
			)
		}
		const material = config.keys[id]
		if (typeof material === 'string' && material.length === 0) {
			throw new InvalidKeysConfigError(`key '${id}' has empty string material`)
		}
	}
}

const ringFromConfig = async (config: KeysConfig): Promise<KeyRing> => {
	validateKeysConfig(config)
	const dataKeys = new Map<string, Buffer>()
	let activeMaterial: Uint8Array | string | undefined
	for (const [id, material] of Object.entries(config.keys)) {
		const resolved = typeof material === 'function' ? await material() : material
		if (typeof resolved !== 'string' && !(resolved instanceof Uint8Array)) {
			throw new InvalidKeysConfigError(`key '${id}' provider returned a non-Uint8Array value`)
		}
		if (resolved.length === 0) {
			throw new InvalidKeysConfigError(`key '${id}' resolved to empty material`)
		}
		dataKeys.set(id, hkdf(resolved, INFO_DATA))
		if (id === config.active) {
			activeMaterial = resolved
		}
	}
	if (activeMaterial === undefined) {
		throw new InvalidKeysConfigError(`active key '${config.active}' resolved to no material`)
	}
	return { activeId: config.active, dataKeys, indexKey: hkdf(activeMaterial, INFO_BIDX) }
}

const configRings = new WeakMap<KeysConfig, Promise<KeyRing>>()
const defaultRings = new Map<string, Promise<KeyRing>>()

/**
 * Resolves a KeysConfig (or the zero-config default derived from the Payload
 * secret) into a cached KeyRing. Async providers run once per config object;
 * a rejected resolution is evicted so a transient KMS failure can retry.
 */
export const resolveKeys = (
	config: KeysConfig | undefined,
	fallbackSecret: string
): Promise<KeyRing> => {
	if (config) {
		let ring = configRings.get(config)
		if (!ring) {
			ring = ringFromConfig(config).catch((error: unknown) => {
				configRings.delete(config)
				throw error
			})
			configRings.set(config, ring)
		}
		return ring
	}
	if (typeof fallbackSecret !== 'string' || fallbackSecret.length === 0) {
		return Promise.reject(
			new InvalidKeysConfigError('no keys configured and the Payload secret is empty')
		)
	}
	let ring = defaultRings.get(fallbackSecret)
	if (!ring) {
		ring = Promise.resolve({
			activeId: DEFAULT_KEY_ID,
			dataKeys: new Map([[DEFAULT_KEY_ID, hkdf(fallbackSecret, INFO_DATA)]]),
			indexKey: hkdf(fallbackSecret, INFO_BIDX),
		})
		defaultRings.set(fallbackSecret, ring)
	}
	return ring
}
