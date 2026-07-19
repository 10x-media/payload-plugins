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

/**
 * Minimum accepted key-material length in bytes. HKDF will happily stretch a
 * 1-byte or all-whitespace secret to a full 32-byte key, hiding a catastrophic
 * lack of entropy, so material shorter than this is rejected outright. 16 is the
 * hard floor; 32+ is recommended and surfaced in the error message.
 */
const MIN_KEY_BYTES = 16

/** Key ids are embedded in the dot-delimited wire format, so dots are banned. */
const KEY_ID_PATTERN = /^[A-Za-z0-9_-]+$/

const materialByteLength = (material: Uint8Array | string): number =>
	typeof material === 'string' ? Buffer.byteLength(material, 'utf8') : material.length

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
	/**
	 * HMAC key for blind indexes, derived from a STABLE root (a dedicated
	 * `KeysConfig.indexKey`, else the Payload secret), NOT the active data key.
	 * Decoupling it means rotating the active data key re-seals ciphertext while
	 * the blind index stays byte-identical, so equality queries keep matching
	 * rows written under the previous active key.
	 */
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
	if (config.indexKey !== undefined) {
		if (typeof config.indexKey !== 'string') {
			throw new InvalidKeysConfigError('indexKey must be a string of key material')
		}
		const bytes = materialByteLength(config.indexKey)
		if (bytes < MIN_KEY_BYTES) {
			throw new InvalidKeysConfigError(
				`indexKey has ${bytes} bytes of material; provide at least ${MIN_KEY_BYTES} (recommend >= 32)`
			)
		}
	}
	for (const id of ids) {
		if (!KEY_ID_PATTERN.test(id)) {
			throw new InvalidKeysConfigError(
				`key id '${id}' must match ${String(KEY_ID_PATTERN)} (it is embedded in the wire format)`
			)
		}
		const material = config.keys[id]
		if (typeof material === 'string') {
			const bytes = materialByteLength(material)
			if (bytes < MIN_KEY_BYTES) {
				throw new InvalidKeysConfigError(
					`key '${id}' has ${bytes} bytes of string material; provide at least ${MIN_KEY_BYTES} (recommend >= 32)`
				)
			}
		}
	}
}

const ringFromConfig = async (config: KeysConfig, fallbackSecret: string): Promise<KeyRing> => {
	validateKeysConfig(config)
	const dataKeys = new Map<string, Buffer>()
	for (const [id, material] of Object.entries(config.keys)) {
		const fromProvider = typeof material === 'function'
		const resolved = fromProvider ? await material() : material
		if (fromProvider) {
			// The provider type is `() => Promise<Uint8Array>`; a string return
			// (e.g. a KMS handing back hex/base64) must not be silently used as
			// UTF-8 IKM. Literal string material stays allowed as a config value.
			if (!(resolved instanceof Uint8Array)) {
				throw new InvalidKeysConfigError(
					`key '${id}' provider must resolve to a Uint8Array, not ${typeof resolved} (string material is only allowed as a literal config value)`
				)
			}
		} else if (typeof resolved !== 'string') {
			throw new InvalidKeysConfigError(`key '${id}' has non-string material`)
		}
		const bytes = materialByteLength(resolved)
		if (bytes < MIN_KEY_BYTES) {
			throw new InvalidKeysConfigError(
				`key '${id}' resolved to ${bytes} bytes of material; provide at least ${MIN_KEY_BYTES} (recommend >= 32)`
			)
		}
		dataKeys.set(id, hkdf(resolved, INFO_DATA))
	}
	// The index key follows a STABLE root (dedicated indexKey material, else the
	// Payload secret), never the active data key, so data-key rotation does not
	// invalidate existing blind indexes (see KeyRing.indexKey).
	const indexMaterial = config.indexKey ?? fallbackSecret
	if (typeof indexMaterial !== 'string' || indexMaterial.length < MIN_KEY_BYTES) {
		throw new InvalidKeysConfigError(
			`blind-index key material has fewer than ${MIN_KEY_BYTES} bytes; set KeysConfig.indexKey (recommend >= 32) or provide a longer Payload secret`
		)
	}
	return { activeId: config.active, dataKeys, indexKey: hkdf(indexMaterial, INFO_BIDX) }
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
			ring = ringFromConfig(config, fallbackSecret).catch((error: unknown) => {
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
	// HKDF stretches any input to 32 bytes, so a short secret would silently derive
	// a low-entropy key; hold the zero-config ring to the same floor as configured keys.
	const secretBytes = materialByteLength(fallbackSecret)
	if (secretBytes < MIN_KEY_BYTES) {
		return Promise.reject(
			new InvalidKeysConfigError(
				`no keys configured and the Payload secret has ${secretBytes} bytes of material; it is too short to derive encryption keys. Lengthen PAYLOAD_SECRET to at least ${MIN_KEY_BYTES} bytes (recommend >= 32) or supply explicit keys`
			)
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
