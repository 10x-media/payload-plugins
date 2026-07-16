import type { PayloadRequest, StaticLabel } from 'payload'

/** Args passed to async per-document resolvers (color presets, icon availability). */
export type FieldsResolverArgs = {
	req: PayloadRequest
	data?: Record<string, unknown>
	siblingData?: Record<string, unknown>
}

/** A color preset: bare CSS string, or a keyed entry usable in linked mode. */
export type ColorPreset = string | { key: string; value: string; label?: StaticLabel }

/** Stored CSS color format for colorField(). */
export type ColorFormat = 'hex' | 'rgb' | 'hsl' | 'oklch'

/** One icon's manifest entry. */
export type IconMeta = { name: string; tags: string[]; categories: string[] }

/** Lazily loaded icon library manifest. */
export type IconManifest = { icons: IconMeta[]; categories: string[] }

/**
 * An icon library adapter. `Icon` is an importMap component path string so
 * adapters stay serializable inside field configs.
 */
export type IconAdapter = {
	slug: string
	label: StaticLabel
	loadManifest: () => Promise<IconManifest>
	Icon: string
	version: 1
}

/** Encryption key set. Values are raw key material or async providers (KMS/Vault). */
export type KeysConfig = {
	active: string
	keys: Record<string, string | (() => Promise<Uint8Array>)>
}

/** What decrypt does when a stored value fails to decrypt. */
export type DecryptFailurePolicy =
	| 'throw'
	| 'null'
	| 'passthrough'
	| ((args: { error: unknown; value: string; collection: string; field: string }) => unknown)

/** Plugin-level defaults for colorField(). Per-field options always win. */
export type ColorGlobalConfig = {
	presets?: ColorPreset[]
	resolvePresets?: (args: FieldsResolverArgs) => Promise<ColorPreset[]>
	format?: ColorFormat
}

/** Plugin-level defaults for iconField(). Per-field options always win. */
export type IconGlobalConfig = {
	adapters?: IconAdapter[]
	resolveAvailable?: (args: FieldsResolverArgs) => Promise<string[]>
}

/** Plugin-level defaults for encryptedField(). Per-field options always win. */
export type EncryptedGlobalConfig = {
	keys?: KeysConfig
	onDecryptFailure?: DecryptFailurePolicy
}

/** Normalized plugin options written to `config.custom['@10x-media/fields']`. */
export type FieldsPluginRegistry = {
	color?: ColorGlobalConfig
	icon?: IconGlobalConfig
	encrypted?: EncryptedGlobalConfig
}
