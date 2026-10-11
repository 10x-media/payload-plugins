import { hasMethods } from '../core/values'
import { peerError } from './peers'

type EncryptedModule = typeof import('@10x-media/fields/encrypted')

const HELPERS: readonly string[] = [
	'decryptFieldValue',
	'encryptedField',
	'isSealed',
	'validateEncryptedBoot',
	'withEncryptedQueryRewrite',
	'withRawEncrypted',
]

const isEncryptedModule = (mod: unknown): mod is EncryptedModule => hasMethods(mod, HELPERS)

/**
 * The encrypted field helpers the providers collection is built on. A literal specifier, so file
 * tracing ships the required peer and a bundler resolves the one copy the host's imports use.
 */
export const loadEncrypted = async (): Promise<EncryptedModule> => {
	const mod: unknown = await import('@10x-media/fields/encrypted')
	if (!isEncryptedModule(mod)) {
		throw new Error(
			peerError(
				'@10x-media/fields',
				'has no encrypted field helpers. Update it: pnpm add @10x-media/fields@latest'
			)
		)
	}
	return mod
}
