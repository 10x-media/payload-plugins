import type { AdminViewServerProps, PayloadComponent, TypedLocale } from 'payload'
import { formatAdminURL } from 'payload/shared'

import type { WikiViewSlot } from '../options'
import { type AdminWikiRegistry, getWikiRegistry } from '../plugin/registry'
import { asLocale, resolveReaderLocale } from '../shared/resolveLocale'

/**
 * Every index slot empty. Reached only when a view renders with `wikiView:
 * false` in the registry, which means the route came from somewhere other than
 * this plugin's own registration.
 */
const NO_SLOTS: Record<WikiViewSlot, PayloadComponent[]> = {
	afterTable: [],
	beforeControls: [],
	beforeTable: [],
}

/** Everything both wiki views derive from their server props before querying. */
export type WikiViewContext = {
	/** The reader's evaluated create permission on wiki pages. */
	canCreate: boolean
	/** The reader's evaluated update permission on wiki pages. */
	canUpdate: boolean
	fallbackLocale: TypedLocale | undefined
	/** The content locale guides load in; undefined when not localized. */
	locale: TypedLocale | undefined
	registry: AdminWikiRegistry
	/** Consumer components per index slot, each array possibly empty. */
	slots: Record<WikiViewSlot, PayloadComponent[]>
	/** Admin-prefixed wiki index URL, e.g. `/admin/wiki`. */
	wikiPath: string
}

/**
 * Resolve the wiki registry, reader locale, and page permissions from the view
 * props. Returns null when the plugin registry is absent (the view was somehow
 * reached without the plugin having run).
 */
export const buildWikiViewContext = (props: AdminViewServerProps): null | WikiViewContext => {
	const { i18n, initPageResult, payload } = props
	const config = payload.config
	const registry = getWikiRegistry(config)
	if (!registry) {
		return null
	}
	const localization = config.localization
	const locale = resolveReaderLocale({
		contentLocales: localization ? localization.localeCodes : [],
		defaultLocale: localization ? localization.defaultLocale : undefined,
		language: i18n.language,
		localeMap: registry.localeMap,
	})
	const pagePermissions = initPageResult.permissions?.collections?.[registry.slugs.pages]
	return {
		canCreate: Boolean(pagePermissions?.create),
		canUpdate: Boolean(pagePermissions?.update),
		fallbackLocale: localization ? asLocale(localization.defaultLocale) : undefined,
		locale: locale ? asLocale(locale) : undefined,
		registry,
		slots: registry.wikiView === false ? NO_SLOTS : registry.wikiView.components,
		wikiPath: formatAdminURL({ adminRoute: config.routes.admin, path: '/wiki' }),
	}
}

/**
 * Login URL for unauthenticated readers, returning them to `returnTo` (an
 * admin-prefixed path) after login. Custom admin views bypass the root
 * router's auth redirect, so the views enforce this themselves.
 */
export const wikiLoginRedirectUrl = (props: AdminViewServerProps, returnTo: string): string => {
	const config = props.payload.config
	const loginUrl = formatAdminURL({
		adminRoute: config.routes.admin,
		path: config.admin.routes.login,
	})
	return `${loginUrl}?redirect=${encodeURIComponent(returnTo)}`
}
