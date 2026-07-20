import type { IconAdapter } from '../../../../types'

/** Lucide adapter. Requires the optional `lucide-react` peer to render glyphs. */
export const lucideAdapter = (): IconAdapter => ({
	slug: 'lucide',
	label: 'Lucide',
	loadManifest: () => import('./generated/manifest').then((m) => m.manifest),
	Icon: '@10x-media/fields/icon/adapters/lucide#LucideAdapterIcon',
	Assets: '@10x-media/fields/icon/adapters/lucide#LucideAdapterAssets',
	Nodes: '@10x-media/fields/icon/adapters/lucide#LucideAdapterNodes',
	version: 1,
})
