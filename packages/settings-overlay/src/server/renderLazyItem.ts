import type { InitPageResult, PayloadRequest, SanitizedPermissions } from 'payload'
import { canAccessAdmin, Forbidden, UnauthorizedError } from 'payload'
import type React from 'react'

import { getOverlay } from '../plugin/registry'
import { isLazyItem } from '../plugin/resolveOptions'
import { passesItemAccess, passesOverlayAccess } from './access'
import { renderComponentItem, renderViewItem } from './renderItem'

/** What the client sends, whichever channel carries it. */
export type LazyItemRequest = {
	itemSlug?: string
	overlayId?: string
	searchParams?: Record<string, string>
}

/**
 * Renders one lazy item for one reader.
 *
 * Shared by both transports, so the two entry points cannot drift on who is allowed to see what.
 * Access is re-checked here in full rather than trusted from the client, because either entry
 * point is reachable by anyone who can call a server function.
 */
export const renderLazyItem = async (
	args: {
		locale: InitPageResult['locale']
		permissions: SanitizedPermissions
		req: PayloadRequest
	} & LazyItemRequest
): Promise<React.ReactNode> => {
	const { itemSlug, locale, overlayId, permissions, req, searchParams } = args

	if (!req.user) {
		throw new UnauthorizedError(req.t)
	}
	await canAccessAdmin({ req })

	const overlay = overlayId ? getOverlay(req.payload.config, overlayId) : undefined
	if (!overlay || !(await passesOverlayAccess(overlay, req))) {
		throw new Forbidden(req.t)
	}

	const item = overlay.items.find((candidate) => candidate.slug === itemSlug)
	if (!item || !isLazyItem(item) || !(await passesItemAccess(item, req))) {
		throw new Forbidden(req.t)
	}

	const shared = {
		i18n: req.i18n,
		importMap: req.payload.importMap,
		layout: overlay.layout,
		overlayId: overlay.id,
		permissions,
		req,
	}

	if (item.type === 'view') {
		return renderViewItem({ ...shared, item, locale, searchParams: searchParams ?? {} })
	}
	if (item.type === 'component') {
		return renderComponentItem({ ...shared, item })
	}

	throw new Forbidden(req.t)
}
