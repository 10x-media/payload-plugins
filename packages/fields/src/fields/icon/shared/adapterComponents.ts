import type { ComponentType } from 'react'
import type { IconManifest } from '../../../types'

export type AdapterIconProps = { className?: string; name: string; size?: number }

export type AdapterAssetsProps = { onReady: (manifest: IconManifest) => void }

export type AdapterComponentsEntry = {
	Assets: ComponentType<AdapterAssetsProps>
	Icon: ComponentType<AdapterIconProps>
}
