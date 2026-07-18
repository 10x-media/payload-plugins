'use client'

import { createGeneratedAdapterComponents, createNodesLoader } from '../../client/generatedAdapter'

const { Assets, Icon } = createGeneratedAdapterComponents({
	iconProps: ({ className, size }) => ({ className, size }),
	loadImports: () => import('./generated/imports').then((m) => m.iconImports),
	loadManifest: () => import('./generated/manifest').then((m) => m.manifest),
})

export const TablerAdapterIcon = Icon
export const TablerAdapterAssets = Assets

export const TablerAdapterNodes = createNodesLoader(() =>
	import('./generated/nodes').then((m) => m.nodes)
)
