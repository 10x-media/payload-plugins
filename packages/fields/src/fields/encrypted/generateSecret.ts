import type { EncryptedGenerateConfig } from './types'

const DEFAULT_CHARSET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'
const MIN_LENGTH = 8
const MAX_LENGTH = 128
const MIN_CHARSET = 10

export interface NormalizedGenerate {
	charset: string
	length: number
	prefix: string
}

/** Validates and normalizes a generate config; throws with the field name on misuse. */
export const normalizeGenerate = (
	config: true | EncryptedGenerateConfig,
	fieldName: string
): NormalizedGenerate => {
	const given = config === true ? {} : config
	const length = given.length ?? 32
	if (!Number.isInteger(length) || length < MIN_LENGTH || length > MAX_LENGTH) {
		throw new Error(
			`@10x-media/fields: encryptedField '${fieldName}': generate.length must be an integer in [${MIN_LENGTH}, ${MAX_LENGTH}]`
		)
	}
	const charset = given.charset ?? DEFAULT_CHARSET
	if (new Set(charset).size < MIN_CHARSET) {
		throw new Error(
			`@10x-media/fields: encryptedField '${fieldName}': generate.charset needs at least ${MIN_CHARSET} distinct characters`
		)
	}
	return { charset, length, prefix: given.prefix ?? '' }
}

/**
 * Crypto-random secret for the admin Generate action. Rejection sampling keeps
 * the distribution uniform over the charset. Async so a future custom source
 * (server-issued keys, a KMS) can slot in behind the same call site.
 */
export const generateSecret = async ({
	charset,
	length,
	prefix,
}: NormalizedGenerate): Promise<string> => {
	const chars: string[] = []
	const limit = 256 - (256 % charset.length)
	while (chars.length < length) {
		const batch = new Uint8Array(length * 2)
		globalThis.crypto.getRandomValues(batch)
		for (const byte of batch) {
			if (byte < limit && chars.length < length) {
				chars.push(charset[byte % charset.length] as string)
			}
		}
	}
	return `${prefix}${chars.join('')}`
}
