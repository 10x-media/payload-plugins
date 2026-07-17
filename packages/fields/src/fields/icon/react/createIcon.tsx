'use client'

import type { ComponentType } from 'react'
import React, { Suspense } from 'react'
import { resolveIconValue } from '../shared/value'
import type { IconProps, IconRendererAdapter, IconRenderProps } from './types'

const Empty: ComponentType<IconRenderProps> = () => null

/**
 * Client dispatcher: per-value React.lazy components cached module-wide so a
 * value renders one stable lazy component (per-icon chunks, loaded once).
 */
export const createIcon = (args: {
	adapters: IconRendererAdapter[]
	defaultLibrary?: string
}): React.FC<IconProps> => {
	const bySlug = new Map(args.adapters.map((adapter) => [adapter.slug, adapter]))
	const defaultLibrary = args.defaultLibrary ?? args.adapters[0]?.slug ?? ''
	const cache = new Map<string, ComponentType<IconRenderProps>>()

	const lazyFor = (library: string, name: string): ComponentType<IconRenderProps> | null => {
		const adapter = bySlug.get(library)
		if (!adapter) return null
		const key = `${library}:${name}`
		let component = cache.get(key)
		if (!component) {
			component = React.lazy(async () => ({
				default: (await adapter.loadIcon(name)) ?? Empty,
			})) as unknown as ComponentType<IconRenderProps>
			cache.set(key, component)
		}
		return component
	}

	const Icon: React.FC<IconProps> = ({ className, fallback = null, icon, label, size = 20 }) => {
		if (!icon) return <>{fallback}</>
		const { library, name } = resolveIconValue(icon, defaultLibrary)
		const Component = lazyFor(library, name)
		if (!Component) return <>{fallback}</>
		return (
			<Suspense fallback={fallback}>
				<Component
					aria-hidden={label ? undefined : true}
					aria-label={label}
					className={className}
					role={label ? 'img' : undefined}
					size={size}
				/>
			</Suspense>
		)
	}
	return Icon
}
