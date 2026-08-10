import type { IconAdapter } from '../../../../types'

/** Radix adapter. Requires the optional `@radix-ui/react-icons` peer to render glyphs. */
export const radixAdapter = (): IconAdapter => ({
	slug: 'radix',
	label: 'Radix',
	loadManifest: () => import('./generated/manifest').then((m) => m.manifest),
	Icon: '@10x-media/fields/icon/adapters/radix#RadixAdapterIcon',
	Assets: '@10x-media/fields/icon/adapters/radix#RadixAdapterAssets',
	Nodes: '@10x-media/fields/icon/adapters/radix#RadixAdapterNodes',
	// A 15x15 filled set. Without this it would inherit the outline convention and every
	// glyph would render stroked.
	canvas: { fill: 'none', stroke: 'none', strokeWidth: 0, viewBox: '0 0 15 15' },
	version: 1,
})
