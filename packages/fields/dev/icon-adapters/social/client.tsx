'use client'

import type { IconManifest, IconNode, IconNodeMap } from '@10x-media/fields/types'
import type { ComponentType } from 'react'
import React, { useEffect, useRef, useState } from 'react'

type IconProps = { className?: string; name: string; size?: number }
type AssetsProps = { onReady: (manifest: IconManifest) => void }
type NodesProps = { onReady: (nodes: IconNodeMap) => void }

// The node-data lives in an admin-only chunk, imported once behind the field
// preview or drawer open, so it never reaches a frontend bundle.
let nodesPromise: Promise<IconNodeMap> | null = null
const loadNodes = (): Promise<IconNodeMap> => {
	nodesPromise ??= import('./generated/nodes').then((m) => m.nodes)
	return nodesPromise
}

/** Same outline convention as the shared drawer glyph, so social reads identically to lucide. */
const Glyph: React.FC<{ className?: string; nodes: IconNode[]; size: number }> = ({
	className,
	nodes,
	size,
}) => (
	<svg
		aria-hidden="true"
		className={className}
		fill="none"
		height={size}
		stroke="currentColor"
		strokeLinecap="round"
		strokeLinejoin="round"
		strokeWidth={2}
		viewBox="0 0 24 24"
		width={size}
	>
		{nodes.map(([tag, attrs], index) => React.createElement(tag, { key: index, ...attrs }))}
	</svg>
)

export const SocialAdapterIcon: ComponentType<IconProps> = ({ className, name, size = 20 }) => {
	const [nodes, setNodes] = useState<IconNode[] | null>(null)
	useEffect(() => {
		let live = true
		void loadNodes().then((map) => {
			if (live) setNodes(map[name] ?? null)
		})
		return () => {
			live = false
		}
	}, [name])
	if (!nodes) {
		return (
			<span aria-hidden className="tenx-icon-placeholder" style={{ height: size, width: size }} />
		)
	}
	return <Glyph className={className} nodes={nodes} size={size} />
}

export const SocialAdapterAssets: ComponentType<AssetsProps> = ({ onReady }) => {
	const onReadyRef = useRef(onReady)
	onReadyRef.current = onReady
	useEffect(() => {
		let live = true
		void import('./generated/manifest').then((m) => {
			if (live) onReadyRef.current(m.manifest)
		})
		return () => {
			live = false
		}
	}, [])
	return null
}

export const SocialAdapterNodes: ComponentType<NodesProps> = ({ onReady }) => {
	const onReadyRef = useRef(onReady)
	onReadyRef.current = onReady
	useEffect(() => {
		let live = true
		void loadNodes().then((loaded) => {
			if (live) onReadyRef.current(loaded)
		})
		return () => {
			live = false
		}
	}, [])
	return null
}
