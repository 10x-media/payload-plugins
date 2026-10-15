import type { Config } from 'payload'

import type { AuditPluginConfig } from '../types'
import {
	collectCustomEventDependencies,
	collectSlotDependencies,
} from '../utilities/customEventComponents'
import type { PluginContext } from './context'
import { validateViewFilters } from './viewFilters'

/** Resolved through the package export map, not a file path, so the import map can find it. */
const VIEW_COMPONENT = '@10x-media/audit-logs/rsc#AuditLogsView'

/**
 * Mounts the browsable log view, plus a second tenant-scoped copy when multi-tenancy
 * is configured. Both stay mounted while the plugin is `disabled`: the view reads the
 * collection, which is still there, and hiding it would strand existing bookmarks.
 *
 * Must run after `registerLogsCollection`: the declared filters are checked against the
 * finished collection.
 */
export const registerViews = (
	config: Config,
	ctx: PluginContext,
	pluginOptions: AuditPluginConfig
): void => {
	const viewConfig = pluginOptions.logs?.view

	if (viewConfig !== false) {
		const logsCollection = config.collections?.find((c) => c.slug === 'audit-logs')
		if (logsCollection) validateViewFilters(logsCollection, viewConfig?.filters)

		config.admin = {
			...config.admin,
			components: {
				...config.admin?.components,
				views: {
					...config.admin?.components?.views,
					auditLogs: {
						Component: {
							path: VIEW_COMPONENT,
							serverProps: {
								pluginOptions,
								...(viewConfig?.forceWhere ? { forceWhere: viewConfig.forceWhere } : {}),
							},
						},
						path: viewConfig?.path ?? '/audit-logs',
					},
				},
			},
			dependencies: {
				...config.admin?.dependencies,
				...collectCustomEventDependencies(viewConfig?.components?.customEvents),
				...collectSlotDependencies(viewConfig?.components),
			},
		}
	}

	const tenantViewConfig = ctx.multiTenancy?.tenantView
	if (!ctx.multiTenancy || tenantViewConfig === false) return

	const tenantViewPath =
		tenantViewConfig != null && tenantViewConfig !== true && tenantViewConfig.path
			? tenantViewConfig.path
			: '/audit-logs-tenant'

	config.admin = {
		...config.admin,
		components: {
			...config.admin?.components,
			views: {
				...config.admin?.components?.views,
				auditLogsTenant: {
					Component: {
						path: VIEW_COMPONENT,
						serverProps: { pluginOptions, useTenant: true },
					},
					path: tenantViewPath,
				},
			},
		},
	}
}
