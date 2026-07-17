'use client'

import type { ComponentType, CSSProperties } from 'react'
import React, { Suspense, useEffect, useRef } from 'react'
import type { IconManifest } from '../../../types'
import type { AdapterAssetsProps, AdapterIconProps } from '../shared/adapterComponents'

/** The prop surface the codegen'd import maps expose, widened by `style` for libraries sized through CSS. */
type GeneratedIconProps = { className?: string; size?: number | string; style?: CSSProperties }

type GeneratedIconComponent = ComponentType<GeneratedIconProps>

type CreateArgs = {
	loadManifest: () => Promise<IconManifest>
	loadImports: () => Promise<Record<string, () => Promise<{ default: GeneratedIconComponent }>>>
	iconProps: (args: { className?: string; size: number }) => GeneratedIconProps
}

const Empty: GeneratedIconComponent = () => null

/**
 * Builds the `Icon`/`Assets` pair for an adapter whose glyphs come from a
 * generated import map. Every icon is its own lazy chunk, so an admin bundle
 * only ever downloads the glyphs it renders. Adapters differ solely in how they
 * take size, hence `iconProps`.
 */
export const createGeneratedAdapterComponents = ({
	iconProps,
	loadImports,
	loadManifest,
}: CreateArgs): {
	Assets: ComponentType<AdapterAssetsProps>
	Icon: ComponentType<AdapterIconProps>
} => {
	const cache = new Map<string, GeneratedIconComponent>()

	const lazyFor = (name: string): GeneratedIconComponent => {
		let component = cache.get(name)
		if (!component) {
			component = React.lazy(async () => {
				const imports = await loadImports()
				const load = imports[name]
				return load ? await load() : { default: Empty }
			})
			cache.set(name, component)
		}
		return component
	}

	const Icon: ComponentType<AdapterIconProps> = ({ className, name, size = 20 }) => {
		const Component = lazyFor(name)
		return (
			<Suspense
				fallback={
					<span
						aria-hidden
						className="tenx-icon-placeholder"
						style={{ height: size, width: size }}
					/>
				}
			>
				<Component {...iconProps({ className, size })} />
			</Suspense>
		)
	}

	const Assets: ComponentType<AdapterAssetsProps> = ({ onReady }) => {
		const onReadyRef = useRef(onReady)
		onReadyRef.current = onReady
		useEffect(() => {
			let live = true
			void loadManifest().then((manifest) => {
				if (live) {
					onReadyRef.current(manifest)
				}
			})
			return () => {
				live = false
			}
		}, [])
		return null
	}

	return { Assets, Icon }
}
