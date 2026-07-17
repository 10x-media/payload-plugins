import type { IconMeta } from '../../../types'

export type IconImportSpec = { module: string; exportName?: string }

export type CustomIconSource = {
	icons: IconMeta[]
	/** Omit when the library has its own dynamic loader (no imports.ts is emitted). */
	importFor?: (icon: IconMeta) => IconImportSpec
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
}

export type LoadedIconSource = {
	icons: IconMeta[]
	importFor?: (icon: IconMeta) => IconImportSpec
}
