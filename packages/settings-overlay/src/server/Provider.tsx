import { getTranslation } from '@payloadcms/translations'
import type { ServerProps } from 'payload'
import type React from 'react'

import { SettingsOverlayClient } from '../client/OverlayProvider'
import type { OverlaySlots } from '../client/slots'
import { getRegistry } from '../plugin/registry'
import type { ClientOverlay, LocalizedLabel, Manifest } from '../types'
import { passesOverlayAccess } from './access'
import { lookupFromConfig } from './entityLabels'
import { getGroupPrefs } from './groupPrefs'
import { buildManifest } from './manifest'
import { renderComponentItem, renderIcon } from './renderItem'
import { renderSlots } from './renderSlots'
import { buildProviderReq } from './req'

export type SettingsOverlayServerProps = {
	children?: React.ReactNode
} & ServerProps

/**
 * The plugin's entry point into the admin, registered in `admin.components.providers`.
 *
 * Everything cheap and reader-specific is computed here rather than fetched later: the rail
 * each overlay shows, the icons, and every `component` item that did not ask to be lazy. The
 * client half receives finished React nodes and a finished manifest, so opening a panel that
 * holds only components costs no round trip at all.
 *
 * Providers render once per full page load, not per client navigation, which is why anything
 * that reads changing data (lists, documents, `lazy` components, views) is fetched on open
 * instead of pre-rendered here.
 */
export const SettingsOverlayServer = async (
	props: SettingsOverlayServerProps
): Promise<React.ReactNode> => {
	const { children, i18n, payload, permissions, user } = props

	const registry = payload?.config ? getRegistry(payload.config) : undefined

	// The provider wraps the login screen too, where there is no reader to compute a rail for.
	if (!registry || !payload || !user || !permissions) {
		return children
	}

	const req = await buildProviderReq({ i18n, payload, user })
	const entities = lookupFromConfig(payload.config)
	const groupPrefs = await getGroupPrefs(req)
	// `getTranslation` widens to a JSX element for rich labels; a rail row is text, so the
	// string form is the whole contract here.
	const translate = (label: LocalizedLabel): string => String(getTranslation(label, i18n))

	const allowed = await Promise.all(
		registry.overlays.map((overlay) => passesOverlayAccess(overlay, req))
	)
	const overlays = registry.overlays.filter((_, index) => allowed[index])

	const manifests: Record<string, Manifest> = {}
	const icons: Record<string, React.ReactNode> = {}
	const rendered: Record<string, React.ReactNode> = {}
	const slots: Record<string, OverlaySlots> = {}
	const clientOverlays: ClientOverlay[] = []

	for (const overlay of overlays) {
		const manifest = await buildManifest({
			entities,
			groupPrefs: groupPrefs?.[overlay.id]?.groups,
			hiddenPredicates: registry.hiddenPredicates,
			locale: i18n.language,
			overlay,
			permissions,
			req,
			translate,
		})
		manifests[overlay.id] = manifest

		const visibleSlugs = new Set(
			manifest.groups.flatMap((group) => group.items.map((item) => item.slug))
		)

		icons[overlay.id] = renderIcon({ component: overlay.icon, importMap: payload.importMap })

		for (const item of overlay.items) {
			if (!visibleSlugs.has(item.slug)) {
				continue
			}
			const key = `${overlay.id}/${item.slug}`
			icons[key] = renderIcon({ component: item.icon, importMap: payload.importMap })

			if (item.type === 'component' && item.lazy !== true) {
				rendered[key] = renderComponentItem({
					i18n,
					importMap: payload.importMap,
					item,
					layout: overlay.layout,
					overlayId: overlay.id,
					permissions,
					req,
				})
			}
		}

		slots[overlay.id] = renderSlots({
			importMap: payload.importMap,
			manifest,
			overlay,
			serverProps: { i18n, payload, permissions, req, user },
		})

		clientOverlays.push({
			addressable: overlay.addressable,
			id: overlay.id,
			label: overlay.label,
			layout: overlay.layout,
			mergeListHeader: overlay.mergeListHeader,
			searchable: overlay.searchable,
			...(overlay.className ? { className: overlay.className } : {}),
		})
	}

	return (
		<SettingsOverlayClient
			icons={icons}
			lazyTransport={registry.lazyTransport}
			manifests={manifests}
			overlays={clientOverlays}
			rendered={rendered}
			slots={slots}
		>
			{children}
		</SettingsOverlayClient>
	)
}
