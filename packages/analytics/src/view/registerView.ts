import type { Config } from 'payload'
import { formatAdminURL } from 'payload/shared'
import type { ResolvedView } from '../core/options'
import { addComponentDependency, VIEW_DEPENDENCY } from '../plugin/adminDependencies'

/** Key the view is registered under in `admin.components.views`. */
export const VIEW_KEY = 'analytics'

/** Resolved through the package export map, not a file path, so the import map can find it. */
export const VIEW_COMPONENT = '@10x-media/analytics/rsc#AnalyticsView'

export const NAV_LINK_COMPONENT = '@10x-media/analytics/client#AnalyticsNavLink'

export interface RegisterViewArgs {
	view: false | ResolvedView
	/** The view's title per language, for the browser tab. */
	title?: Record<string, string>
}

/**
 * Mounts view and nav link; the link has no access context, so a reader `access.view` denies lands
 * on the no-access message. `meta` titles the tab in fallback language until the view retitles it.
 */
export const registerView = (config: Config, args: RegisterViewArgs): void => {
	const { view, title } = args
	if (view === false) {
		return
	}
	const href = formatAdminURL({ adminRoute: config.routes?.admin ?? '/admin', path: view.path })
	const fallbackLanguage = config.i18n?.fallbackLanguage ?? 'en'
	const metaTitle = title?.[fallbackLanguage] ?? title?.en
	if (view.Component !== undefined) {
		addComponentDependency(config, VIEW_DEPENDENCY, view.Component)
	}
	config.admin = {
		...config.admin,
		components: {
			...config.admin?.components,
			views: {
				...config.admin?.components?.views,
				[VIEW_KEY]: {
					Component: { path: VIEW_COMPONENT },
					path: view.path,
					exact: true,
					...(metaTitle === undefined ? {} : { meta: { title: metaTitle } }),
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
