import type { IconMeta, IconNodeMap } from '../../../types'

export type IconImportSpec = { module: string; exportName?: string }

export type CustomIconSource = {
	icons: IconMeta[]
	/** Omit when the library has its own dynamic loader (no imports.ts is emitted). */
	importFor?: (icon: IconMeta) => IconImportSpec
	/**
	 * Bulk glyph node-data keyed by icon name. Present emits `nodes.ts` for the
	 * drawer to render inline SVG without per-icon imports; omit for libraries the
	 * drawer renders through the per-icon `Icon` component (e.g. radix).
	 */
	nodes?: IconNodeMap
}

export type IconManifestSource = 'lucide' | 'radix' | 'tabler' | CustomIconSource

export type GenerateIconManifestOptions = {
	source: IconManifestSource
	/** Directory receiving `manifest.ts` (+ `imports.ts` when the source maps imports). */
	outDir: string
	/**
	 * Emit icons without categories when a source cannot fetch its category
	 * metadata. Off by default so an offline or upstream-changed run fails loudly
	 * instead of quietly overwriting committed output with the categories dropped.
	 */
	allowMissingCategories?: boolean
	/**
	 * Command named in the generated-file header so a reader runs the right regen.
	 * Defaults to `pnpm generate:manifests`; a BYO source pass its own script.
	 */
	regenCommand?: string
}

export type LoadedIconSource = {
	icons: IconMeta[]
	importFor?: (icon: IconMeta) => IconImportSpec
	nodes?: IconNodeMap
}
