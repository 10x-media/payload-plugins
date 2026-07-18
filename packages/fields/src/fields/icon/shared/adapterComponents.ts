import type { ComponentType } from 'react'
import type { IconManifest, IconNodeMap } from '../../../types'

export type AdapterIconProps = { className?: string; name: string; size?: number }

export type AdapterAssetsProps = { onReady: (manifest: IconManifest) => void }

export type AdapterNodesProps = { onReady: (nodes: IconNodeMap) => void }

export type AdapterComponentsEntry = {
	Assets: ComponentType<AdapterAssetsProps>
	Icon: ComponentType<AdapterIconProps>
	/** Loads bulk glyph node-data for fast drawer rendering; absent for per-icon libraries (radix). */
	Nodes?: ComponentType<AdapterNodesProps>
}
