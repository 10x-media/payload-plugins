'use client'

import type { ComponentType, ReactNode } from 'react'
import React, { createContext, Suspense, useContext } from 'react'
import { resolveIconValue } from '../shared/value'
import { resolveRenderedIcon } from './resolveRendered'
import type { IconProps, IconRendererAdapter, IconRenderProps } from './types'

/**
 * Carries the caller's `fallback` down to the cached lazy component. The lazy is
 * cached module-wide on `library:name` so a repeated value loads its chunk once,
 * which means it cannot close over any one caller's prop. Context is how a shared
 * component reads a per-subtree value without giving up that cache.
 */
const FallbackContext = createContext<ReactNode>(null)

/** Stands in for an icon the adapter resolved to null, so a miss renders the caller's fallback. */
const MissingIcon: ComponentType<IconRenderProps> = () => <>{useContext(FallbackContext)}</>

/**
 * Client dispatcher: per-value React.lazy components cached module-wide so a
 * value renders one stable lazy component (per-icon chunks, loaded once).
 *
 * A rejected load stays cached, because React.lazy caches its own rejection.
 * That is deliberate: retrying would re-request a failing icon on every render
 * against an endpoint already struggling. `createRscIcon` evicts instead, because
 * a server render has no equivalent re-render pressure.
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
				default: (await resolveRenderedIcon(adapter, name)) ?? MissingIcon,
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
		const tree = (
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
		// Provider only where there is something to carry, so the common decorative
		// call renders exactly the tree it always did.
		return fallback == null ? (
			tree
		) : (
			<FallbackContext.Provider value={fallback}>{tree}</FallbackContext.Provider>
		)
	}
	return Icon
}
