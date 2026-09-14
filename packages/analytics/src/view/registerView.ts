import type { Config } from 'payload'
import { formatAdminURL } from 'payload/shared'
import type { AnalyticsPluginOptions, ResolvedView } from '../core/options'

/** Key the view is registered under in `admin.components.views`. */
export const VIEW_KEY = 'analytics'

/** Resolved through the package export map, not a file path, so the import map can find it. */
export const VIEW_COMPONENT = '@10x-media/analytics/rsc#AnalyticsView'

export const NAV_LINK_COMPONENT = '@10x-media/analytics/client#AnalyticsNavLink'

export interface RegisterViewArgs {
	view: false | ResolvedView
	/**
	 * The app's own options, handed to the server component untouched: it resolves them
	 * again per request, because `access.view` and the resolvers are functions the config
	 * cannot serialize into client props.
	 */
	pluginOptions: AnalyticsPluginOptions
}

/**
 * Mounts the analytics view and its nav link. The link is a client component with no
 * access context, so it is registered whenever the view is: a reader `access.view`
 * denies follows it and lands on the view's no-access message.
 */
export const registerView = (config: Config, args: RegisterViewArgs): void => {
	const { view, pluginOptions } = args
	if (view === false) {
		return
	}
	const href = formatAdminURL({ adminRoute: config.routes?.admin ?? '/admin', path: view.path })
	config.admin = {
		...config.admin,
		components: {
			...config.admin?.components,
			views: {
				...config.admin?.components?.views,
				[VIEW_KEY]: {
					Component: { path: VIEW_COMPONENT, serverProps: { pluginOptions } },
					path: view.path,
					exact: true,
				},
			},
			afterNavLinks: [
				...(config.admin?.components?.afterNavLinks ?? []),
				{
					path: NAV_LINK_COMPONENT,
					clientProps: {
						href,
						...(view.navLabel !== undefined ? { label: view.navLabel } : {}),
					},
				},
			],
		},
	}
}
