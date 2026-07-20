'use client'

import type { IconName } from 'lucide-react/dynamic'
import type { ComponentType } from 'react'
import React, { Suspense, useEffect, useRef } from 'react'
import { createNodesLoader } from '../../client/generatedAdapter'
import type { AdapterAssetsProps, AdapterIconProps } from '../../shared/adapterComponents'

// lucide-react ships DynamicIcon with per-icon lazy chunks, so this adapter needs no generated import map.
const DynamicIcon = React.lazy(() =>
	import('lucide-react/dynamic').then((m) => ({ default: m.DynamicIcon }))
)

export const LucideAdapterIcon: ComponentType<AdapterIconProps> = ({
	className,
	name,
	size = 20,
}) => (
	<Suspense
		fallback={
			<span aria-hidden className="tenx-icon-placeholder" style={{ height: size, width: size }} />
		}
	>
		<DynamicIcon className={className} fallback={() => null} name={name as IconName} size={size} />
	</Suspense>
)

export const LucideAdapterAssets: ComponentType<AdapterAssetsProps> = ({ onReady }) => {
	const onReadyRef = useRef(onReady)
	onReadyRef.current = onReady
	useEffect(() => {
		let live = true
		void import('./generated/manifest').then((m) => {
			if (live) {
				onReadyRef.current(m.manifest)
			}
		})
		return () => {
			live = false
		}
	}, [])
	return null
}

export const LucideAdapterNodes = createNodesLoader(() =>
	import('./generated/nodes').then((m) => m.nodes)
)
