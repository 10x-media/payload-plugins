import { RenderServerComponent } from '@payloadcms/ui/elements/RenderServerComponent'
import type { ImportMap, PayloadComponent } from 'payload'
import type React from 'react'

import type { OverlaySlots } from '../client/slots'
import { UNGROUPED_KEY } from '../client/slots'
import type { ResolvedOverlay } from '../plugin/resolveOptions'
import type { Manifest } from '../types'

/**
 * Renders every configured slot replacement for one overlay.
 *
 * Slots are rendered here rather than in the panel so a replacement may be a server component,
 * exactly as the rest of the admin's custom components may. Only serializable props cross the
 * boundary; the dynamic half (which row is active, what the search box holds) reaches the
 * replacement through the hooks in `exports/client`, which is what keeps a slot from being a
 * fork of the panel.
 */
export const renderSlots = (args: {
	importMap: ImportMap
	manifest: Manifest | undefined
	overlay: ResolvedOverlay
	serverProps: object
}): OverlaySlots => {
	const { importMap, manifest, overlay, serverProps } = args
	const components = overlay.components ?? {}

	const render = (component: PayloadComponent | undefined, clientProps: object): React.ReactNode =>
		component
			? RenderServerComponent({ clientProps, Component: component, importMap, serverProps })
			: undefined

	const shared = { layout: overlay.layout, overlayId: overlay.id }

	const slots: OverlaySlots = {
		Empty: render(components.Empty, shared),
		Header: render(components.Header, shared),
		Panel: render(components.Panel, shared),
		Rail: render(components.Rail, shared),
		Search: render(components.Search, shared),
	}

	if (components.RailGroup && manifest) {
		slots.RailGroup = Object.fromEntries(
			manifest.groups.map((group) => [
				group.label ?? UNGROUPED_KEY,
				render(components.RailGroup, { ...shared, group: { label: group.label } }),
			])
		)
	}

	if (components.RailItem && manifest) {
		slots.RailItem = Object.fromEntries(
			manifest.groups.flatMap((group) =>
				group.items.map((item) => [item.slug, render(components.RailItem, { ...shared, item })])
			)
		)
	}

	return slots
}
