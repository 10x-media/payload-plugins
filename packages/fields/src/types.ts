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

/** One SVG child of a glyph: an element tag and its attribute map, matching lucide-static's icon-nodes shape. */
export type IconNode = [tag: string, attrs: Record<string, string>]

/** An icon library's glyphs keyed by name, so the drawer renders inline SVG in bulk instead of per-icon imports. */
export type IconNodeMap = Record<string, IconNode[]>

/**
 * An icon library adapter. `Icon`, `Assets`, and `Nodes` are importMap component
 * path strings so adapters stay serializable inside field configs.
 */
export type IconAdapter = {
	slug: string
	label: StaticLabel
	/** Lazy manifest loader; used server-side for validation and never bundled eagerly. */
	loadManifest: () => Promise<IconManifest>
	/** importMap path of a client component rendering one icon by name, e.g. '@10x-media/fields/icon/adapters/lucide#LucideAdapterIcon'. */
	Icon: string
	/** importMap path of a client component that loads the manifest for the admin drawer. */
	Assets: string
	/**
	 * importMap path of a client component that loads this library's bulk node-data
	 * for fast drawer rendering. Omit for libraries that ship a single shared module
	 * (e.g. radix); the drawer then falls back to the per-icon `Icon` component.
	 */
	Nodes?: string
	version: 1
}

/** Resolves which library slugs a request may pick from. */
export type IconAvailabilityResolver = (args: FieldsResolverArgs) => Promise<string[]> | string[]

/** Encryption key set. Values are raw key material or async providers (KMS/Vault). */
export type KeysConfig = {
	active: string
	/**
	 * Optional dedicated material for the blind-index (HMAC) key. Defaults to the
	 * Payload secret. Kept independent of the data keys on purpose: rotating the
	 * active data key must NOT change the index key, or every previously written
	 * blind index silently stops matching. Change this only alongside a full
	 * blind-index rebuild.
	 */
	indexKey?: string
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
	defaultLibrary?: string
	resolveAvailable?: IconAvailabilityResolver
	/**
	 * Library slugs always offered for selection regardless of `resolveAvailable`,
	 * so a shared library (e.g. brand icons) need not be repeated in every tenant's
	 * resolver return. A per-field `alwaysAvailable` unions with this global set.
	 * Slugs with no registered adapter are silently dropped.
	 */
	alwaysAvailable?: string[]
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
