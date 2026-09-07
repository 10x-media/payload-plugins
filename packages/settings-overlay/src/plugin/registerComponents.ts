import type { Config, PayloadComponent } from 'payload'

import type { SettingsOverlayComponents } from '../types'
import {
	BUTTON_PATH,
	DEPENDENCY_PREFIX,
	DISPATCHER_PATH,
	DISPATCHER_WIDGET_SLUG,
	PROVIDER_PATH,
	REPORTER_PATH,
} from './constants'
import { hasLazyItems, type ResolvedOverlay } from './resolveOptions'

type Dependencies = NonNullable<NonNullable<Config['admin']>['dependencies']>

/** The string form of a component path, whichever way it was declared. */
const pathOf = (component: PayloadComponent): string | undefined => {
	if (typeof component === 'string') {
		return component
	}
	return typeof component === 'object' && component ? component.path : undefined
}

const SLOT_NAMES = [
	'Empty',
	'Header',
	'Panel',
	'Rail',
	'RailGroup',
	'RailItem',
	'Search',
] as const satisfies readonly (keyof SettingsOverlayComponents)[]

/**
 * Every component path the config mentions, registered in `admin.dependencies` so the
 * import map generator finds it.
 *
 * It has to be told: the overlays live under `config.custom`, which the generator does not
 * walk (`bin/generateImportMap/iterateConfig.ts` walks `admin.dependencies` and the standard
 * slots). Without this, a configured icon or component item resolves to nothing at runtime.
 */
const collectDependencies = (overlays: ResolvedOverlay[]): Dependencies => {
	const dependencies: Dependencies = {
		[`${DEPENDENCY_PREFIX}-provider`]: { type: 'component', path: PROVIDER_PATH },
		[`${DEPENDENCY_PREFIX}-reporter`]: { type: 'component', path: REPORTER_PATH },
		[`${DEPENDENCY_PREFIX}-button`]: { type: 'component', path: BUTTON_PATH },
	}

	const add = (key: string, component: PayloadComponent | undefined): void => {
		const path = component ? pathOf(component) : undefined
		if (path) {
			dependencies[key] = { path, type: 'component' }
		}
	}

	for (const overlay of overlays) {
		add(`${DEPENDENCY_PREFIX}-icon-${overlay.id}`, overlay.icon)

		for (const slot of SLOT_NAMES) {
			add(`${DEPENDENCY_PREFIX}-slot-${overlay.id}-${slot}`, overlay.components?.[slot])
		}

		for (const item of overlay.items) {
			add(`${DEPENDENCY_PREFIX}-icon-${overlay.id}-${item.slug}`, item.icon)
			if (item.type === 'component') {
				add(`${DEPENDENCY_PREFIX}-item-${overlay.id}-${item.slug}`, item.component)
			}
		}
	}

	return dependencies
}

/**
 * Registers the provider, every configured component path, and (only when the config holds
 * an item that cannot be rendered ahead of time) the dispatcher widget.
 */
export const registerComponents = (
	config: Config,
	overlays: ResolvedOverlay[],
	lazyTransport: 'server-function' | 'widget'
): Config['admin'] => {
	const admin = config.admin ?? {}

	const next: NonNullable<Config['admin']> = {
		...admin,
		components: {
			...admin.components,
			providers: [...(admin.components?.providers ?? []), PROVIDER_PATH],
		},
		dependencies: { ...admin.dependencies, ...collectDependencies(overlays) },
	}

	// Under `server-function` the consumer wires the transport themselves, so there is nothing to
	// register and nothing to appear in the dashboard's widget drawer.
	if (lazyTransport === 'widget' && hasLazyItems(overlays)) {
		next.dashboard = {
			...admin.dashboard,
			widgets: [
				...(admin.dashboard?.widgets ?? []),
				{
					slug: DISPATCHER_WIDGET_SLUG,
					Component: DISPATCHER_PATH,
					label: 'Settings overlay (internal)',
				},
			],
		}
	}

	return next
}
