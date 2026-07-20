import type { IconAdapter } from '../../../../types'

/** Radix adapter. Requires the optional `@radix-ui/react-icons` peer to render glyphs. */
export const radixAdapter = (): IconAdapter => ({
	slug: 'radix',
	label: 'Radix',
	loadManifest: () => import('./generated/manifest').then((m) => m.manifest),
	Icon: '@10x-media/fields/icon/adapters/radix#RadixAdapterIcon',
	Assets: '@10x-media/fields/icon/adapters/radix#RadixAdapterAssets',
	version: 1,
})
