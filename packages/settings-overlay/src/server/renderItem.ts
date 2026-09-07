import type { I18nClient } from '@payloadcms/translations'
import { RenderServerComponent } from '@payloadcms/ui/elements/RenderServerComponent'
import { getVisibleEntities } from '@payloadcms/ui/shared'
import { getClientConfig } from '@payloadcms/ui/utilities/getClientConfig'
import type {
	ImportMap,
	InitPageResult,
	PayloadComponent,
	PayloadRequest,
	SanitizedPermissions,
} from 'payload'
import { parseCookies } from 'payload'
import type React from 'react'

import type { ComponentItem, OverlayLayout, SettingsOverlayEmbedServer, ViewItem } from '../types'

/** Renders a configured icon. Icons take no server props; they are decoration. */
export const renderIcon = (args: {
	component: PayloadComponent | undefined
	importMap: ImportMap
}): React.ReactNode =>
	args.component
		? RenderServerComponent({ Component: args.component, importMap: args.importMap })
		: null

const embedFor = (args: {
	itemSlug: string
	itemType: SettingsOverlayEmbedServer['itemType']
	layout: OverlayLayout
	overlayId: string
}): SettingsOverlayEmbedServer => args

/**
 * A `component` item, rendered with panel props.
 *
 * `RenderServerComponent` decides whether the component is a server or a client one and only
 * hands `serverProps` to the former, so a component item may be either without saying so.
 */
export const renderComponentItem = (args: {
	i18n: I18nClient
	importMap: ImportMap
	item: ComponentItem
	layout: OverlayLayout
	overlayId: string
	permissions: SanitizedPermissions
	req: PayloadRequest
}): React.ReactNode => {
	const settingsOverlayEmbed = embedFor({
		itemSlug: args.item.slug,
		itemType: 'component',
		layout: args.layout,
		overlayId: args.overlayId,
	})

	return RenderServerComponent({
		clientProps: { settingsOverlayEmbed },
		Component: args.item.component,
		importMap: args.importMap,
		serverProps: {
			i18n: args.i18n,
			payload: args.req.payload,
			permissions: args.permissions,
			req: args.req,
			settingsOverlayEmbed,
			user: args.req.user,
		},
	})
}

/**
 * A registered admin view, rendered as its own page would render it.
 *
 * The view gets the `initPageResult` Payload's root page builds, so it cannot tell it is
 * inside a panel and needs no changes to work here. The chrome it wraps itself in is removed
 * either by the view reading `settingsOverlayEmbed` (yours) or by the `/embed` template shim
 * (somebody else's), never here.
 */
export const renderViewItem = (args: {
	i18n: I18nClient
	importMap: ImportMap
	item: ViewItem
	layout: OverlayLayout
	locale: InitPageResult['locale']
	overlayId: string
	permissions: SanitizedPermissions
	req: PayloadRequest
	searchParams: Record<string, string>
}): null | React.ReactNode => {
	const { payload, user } = args.req
	const view = payload.config.admin.components.views?.[args.item.viewKey]
	if (!view?.Component || !user) {
		return null
	}

	const clientConfig = getClientConfig({
		config: payload.config,
		i18n: args.i18n,
		importMap: args.importMap,
		user,
	})

	const languageOptions = Object.entries(payload.config.i18n.supportedLanguages || {}).map(
		([language, languageConfig]) => ({
			label: languageConfig.translations.general.thisLanguage,
			value: language,
		})
	) as InitPageResult['languageOptions']

	const initPageResult: InitPageResult = {
		collectionConfig: undefined,
		cookies: parseCookies(args.req.headers),
		docID: undefined,
		globalConfig: undefined,
		languageOptions,
		locale: args.locale,
		permissions: args.permissions,
		req: args.req,
		translations: args.i18n.translations,
		visibleEntities: getVisibleEntities({ req: args.req }),
	}

	const settingsOverlayEmbed = embedFor({
		itemSlug: args.item.slug,
		itemType: 'view',
		layout: args.layout,
		overlayId: args.overlayId,
	})

	return RenderServerComponent({
		clientProps: { clientConfig, settingsOverlayEmbed },
		Component: view.Component,
		importMap: args.importMap,
		serverProps: {
			clientConfig,
			i18n: args.i18n,
			importMap: args.importMap,
			initPageResult,
			params: { segments: (view.path ?? '').split('/').filter(Boolean) },
			payload,
			// The page's own parameters, so a view that pages or filters through the URL sees them.
			searchParams: args.searchParams,
			settingsOverlayEmbed,
			viewActions: [],
		},
	})
}
