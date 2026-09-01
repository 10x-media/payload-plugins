import type { Payload, PayloadRequest, StaticLabel } from 'payload'
import type { UnitId } from './fields/measurement/engine/units'
import type { MeasurementUsage } from './fields/measurement/engine/usages'

/** Args passed to async per-document resolvers (color presets, icon availability). */
export type FieldsResolverArgs = {
	req: PayloadRequest
	data?: Record<string, unknown>
	siblingData?: Record<string, unknown>
}

/**
 * A color that varies by color scheme. Consumers read members individually, so
 * an optional third scheme stays a non-breaking addition.
 */
export type ColorSchemeValue = { light: string; dark: string }

/** A color preset: bare CSS string, or a keyed entry usable in linked mode. */
export type ColorPreset =
	| string
	| { key: string; value: string | ColorSchemeValue; label?: StaticLabel }

/** Stored CSS color format for colorField(). */
export type ColorFormat = 'hex' | 'rgb' | 'hsl' | 'oklch'

/** One icon's manifest entry. */
export type IconMeta = {
	name: string
	tags: string[]
	categories: string[]
	/**
	 * Human-readable name shown to editors, replacing the one derived from `name`.
	 * Supply it wherever the name is a code rather than words: `HUN` reads as `Hun`
	 * without one, and a screen reader announces that. Omit it and every existing
	 * manifest keeps its derived label unchanged.
	 */
	label?: StaticLabel
}

/**
 * What an icon adapter's async resolvers receive. `req` is optional because Payload
 * renders list cells without one (`DefaultServerCellComponentProps` carries `payload`
 * and `i18n` only), so a resolver must not depend on it being present.
 */
export type IconLayerContext = { payload: Payload; req?: PayloadRequest }

/** Lazily loaded icon library manifest. */
export type IconManifest = { icons: IconMeta[]; categories: string[] }

/**
 * One SVG child of a glyph: an element tag and its attribute map, matching lucide-static's
 * icon-nodes shape. An optional third element carries children, so a glyph needing `<g>`
 * or `<defs>` is expressible; the two-element form every generated manifest already uses
 * keeps parsing exactly as before.
 */
export type IconNode =
	| [tag: string, attrs: Record<string, string>]
	| [tag: string, attrs: Record<string, string>, children: IconNode[]]

/** An icon library's glyphs keyed by name, so the drawer renders inline SVG in bulk instead of per-icon imports. */
export type IconNodeMap = Record<string, IconNode[]>

/**
 * How a layer's glyphs paint in the admin. Every variant carries importMap path
 * strings, so a layer stays serializable inside a field config.
 */
export type IconRenderStrategy =
	/** Bulk node-data rendered as inline SVG. `load` resolves `() => Promise<IconNodeMap>`. */
	| { type: 'nodes'; canvas?: IconCanvas; load: string }
	/** Bulk raw SVG, sprited once client-side. `load` resolves `() => Promise<Record<string, string>>`. */
	| { type: 'svg'; load: string }
	/** One image per icon. `resolve` resolves `(name: string) => null | string`. */
	| { type: 'url'; resolve: string }
	/** A component per icon, for libraries that ship their own lazy glyph components. */
	| { type: 'component'; Icon: string }

/**
 * The SVG canvas a library's glyphs are drawn on. Defaults are lucide's outline
 * convention, which is what the drawer hardcoded before layers existed, so a layer
 * that declares nothing renders exactly as lucide and tabler always have.
 */
export type IconCanvas = {
	viewBox?: string
	fill?: string
	stroke?: string
	strokeWidth?: number | string
	strokeLinecap?: 'butt' | 'round' | 'square'
	/** SVG2's `arcs` and `miter-clip` are omitted: React does not type them and browsers barely support them. */
	strokeLinejoin?: 'bevel' | 'miter' | 'round'
}

/**
 * How long a layer's manifest listing may be reused. `'forever'` is the default and
 * matches how a static build artifact has always been cached. A `ttl` in milliseconds
 * suits a layer whose contents change at runtime.
 *
 * Note this governs the drawer *listing* only. Validation goes through `resolveMeta`,
 * which is never cached, so an icon added at runtime is valid immediately regardless.
 */
export type IconLayerCache = 'forever' | { ttl: number }

/**
 * One source within a library. Layers are ordered and later ones win by name, so a
 * static base set can be overridden by a runtime-backed layer under a single slug.
 */
export type IconLayer = {
	/** Diagnostic identity, unique within the adapter. Never part of a stored value. */
	id: string
	/** Lists this layer's icons for the drawer. */
	loadManifest: (ctx: IconLayerContext) => Promise<IconManifest>
	/** Exact single-name lookup, serving validation and label resolution. Never cached. */
	resolveMeta?: (name: string, ctx: IconLayerContext) => Promise<IconMeta | null>
	/**
	 * Batched `resolveMeta`. Lookups issued in one microtask are coalesced into a single
	 * call, which is what turns a document holding eight icon fields, or a fifty-row list,
	 * into one query instead of eight or fifty.
	 */
	resolveMetaMany?: (names: string[], ctx: IconLayerContext) => Promise<Map<string, IconMeta>>
	/** Cache policy for `loadManifest`. Defaults to `'forever'`. */
	cache?: IconLayerCache
	/**
	 * Extra cache-key segment derived from the request. A layer whose listing differs per
	 * tenant, locale or user MUST supply this, or one caller's manifest is served to
	 * another: the cache is otherwise keyed by adapter slug and layer id alone, which are
	 * identical across tenants by construction.
	 */
	cacheKey?: (ctx: IconLayerContext) => string
	/** How this layer's glyphs paint. */
	render: IconRenderStrategy
}

/**
 * An icon library adapter. `Icon`, `Assets`, and `Nodes` are importMap component
 * path strings so adapters stay serializable inside field configs.
 */
export type IconAdapter = {
	slug: string
	label: StaticLabel
	/** Lazy manifest loader; used server-side for validation and never bundled eagerly. */
	loadManifest: () => Promise<IconManifest>
	/**
	 * Exact single-name lookup, serving validation (non-null means the name exists)
	 * and label resolution from one query. Supply it for a library whose contents
	 * change at runtime: it stays correct where a cached manifest snapshot cannot,
	 * and it answers without materialising the whole manifest. Omit it and the
	 * cached manifest index answers both.
	 */
	resolveMeta?: (name: string, ctx: IconLayerContext) => Promise<IconMeta | null>
	/** Batched `resolveMeta`; see `IconLayer.resolveMetaMany`. */
	resolveMetaMany?: (names: string[], ctx: IconLayerContext) => Promise<Map<string, IconMeta>>
	/**
	 * Ordered sources composing this library, later winning by name. Omit for a
	 * single-source library, which is every adapter written before layers existed:
	 * `loadManifest`, `resolveMeta`, `Icon`, `Assets` and `Nodes` then drive everything
	 * exactly as they did.
	 */
	layers?: IconLayer[]
	/** importMap path of a client component rendering one icon by name, e.g. '@10x-media/fields/icon/adapters/lucide#LucideAdapterIcon'. */
	Icon: string
	/** importMap path of a client component that loads the manifest for the admin drawer. */
	Assets: string
	/**
	 * importMap path of a client component that loads this library's bulk node-data
	 * for fast drawer rendering. Omit for a library with no node-data; the drawer then
	 * falls back to the per-icon `Icon` component.
	 */
	Nodes?: string
	/**
	 * Canvas its `Nodes` glyphs are drawn on. Omitted means lucide's outline convention,
	 * which is what the drawer assumed before this existed, so every library that shipped
	 * without one is unaffected. A filled set must declare its own or it inherits a stroke.
	 */
	canvas?: IconCanvas
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

/** Plugin-level defaults for measurementField(). Per-field options always win. */
export type MeasurementGlobalConfig = {
	defaultUnits?: Partial<Record<MeasurementUsage, UnitId>>
}

/** Normalized plugin options written to `config.custom['@10x-media/fields']`. */
export type FieldsPluginRegistry = {
	color?: ColorGlobalConfig
	icon?: IconGlobalConfig
	encrypted?: EncryptedGlobalConfig
	measurement?: MeasurementGlobalConfig
}
