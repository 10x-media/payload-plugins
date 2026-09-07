import type { WidgetServerProps } from 'payload'
import type React from 'react'

import { type LazyItemRequest, renderLazyItem } from './renderLazyItem'

/**
 * WORKAROUND, and the default transport. Renders a lazy overlay item by riding Payload's
 * `render-widget` server function.
 *
 * What is being worked around: a panel has to render a server component after a click, without a
 * navigation, and the only transport for that is a Next server action. Payload funnels every one
 * of its own through a single action declared in the host's generated `app/(payload)/layout.tsx`
 * and dispatches by name (`handleServerFunctions`), with no config-level way to add a name.
 * Requiring every consumer to edit a file Payload marks "DO NOT MODIFY" is a worse tax than this,
 * so that route is offered as `lazyTransport: 'server-function'` instead of imposed.
 *
 * Why this particular function: `render-widget` is already in `baseServerFunctions`, checks
 * `req.user`, and does exactly one thing, which is to render a registered `PayloadComponent` with
 * a real request and a caller-supplied data object. That is the whole capability needed. The cost
 * is that the dispatcher widget appears in the dashboard's "Add widget" drawer, so the plugin
 * registers it only when the config holds a lazy item *and* this transport is in use.
 *
 * `render-field` can do the same job and would need no widget, but its handler is exported as
 * `_internal_renderFieldHandler` and documented as breakable in minor releases, and it merges the
 * caller's partial into the process-global schema map with `clone: false`. A younger, explicitly
 * unstable API with a cross-request mutation hazard is a worse bet than a drawer row.
 */
export const SettingsOverlayItemDispatcher = async (
	props: WidgetServerProps
): Promise<React.ReactNode> => {
	const { locale, permissions, req, widgetData } = props
	const { itemSlug, overlayId, searchParams } = (widgetData ?? {}) as LazyItemRequest

	return renderLazyItem({ itemSlug, locale, overlayId, permissions, req, searchParams })
}
