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
}

export type LoadedIconSource = {
	icons: IconMeta[]
	importFor?: (icon: IconMeta) => IconImportSpec
}
