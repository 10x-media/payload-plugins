import type { Config } from 'payload'
import { parsePayloadComponent } from 'payload/shared'
import type { AnalyticsComponent } from '../core/options'

/** Where the host's `countryFlags.Component` sits in `admin.dependencies`. */
export const FLAG_DEPENDENCY = '@10x-media/analytics:countryFlag'

/** Where the host's `view.Component` sits in `admin.dependencies`. */
export const VIEW_DEPENDENCY = '@10x-media/analytics:view'

/**
 * The one string the import map keys a component under, `path#export`: `payload generate:importmap`
 * reads a dependency's `path` alone, so an export named in `exportName` has to move into it.
 */
export const importMapPath = (component: AnalyticsComponent): string => {
	const { path, exportName } = parsePayloadComponent(component)
	return `${path}#${exportName}`
}

/**
 * A host component the plugin renders itself via `RenderServerComponent`, which Payload's config
 * walk never sees; `admin.dependencies` is where `generate:importmap` picks it up.
 */
export const addComponentDependency = (
	config: Config,
	key: string,
	component: AnalyticsComponent
): void => {
	config.admin = {
		...config.admin,
		dependencies: {
			...config.admin?.dependencies,
			[key]: { type: 'component', path: importMapPath(component) },
		},
	}
}
