'use client'

import { createGeneratedAdapterComponents } from '../../client/generatedAdapter'

// Radix icons size through width/height SVG props, not a `size` prop.
const { Assets, Icon } = createGeneratedAdapterComponents({
	iconProps: ({ className, size }) => ({ className, style: { height: size, width: size } }),
	loadImports: () => import('./generated/imports').then((m) => m.iconImports),
	loadManifest: () => import('./generated/manifest').then((m) => m.manifest),
})

export const RadixAdapterIcon = Icon
export const RadixAdapterAssets = Assets
