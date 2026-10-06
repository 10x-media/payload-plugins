import type { PayloadRequest } from 'payload'

import type { ResolvedOverlay } from '../plugin/resolveOptions'
import type { HiddenPredicates, SettingsOverlayItem } from '../types'

/**
 * Runs an access function fail-closed: a missing function means open, a thrown one means
 * denied and logged. A door that throws must not take the whole admin down with it.
 */
const run = async (
	access: (() => boolean | Promise<boolean>) | undefined,
	req: PayloadRequest
): Promise<boolean> => {
	if (!access) {
		return true
	}
	try {
		return Boolean(await access())
	} catch (error) {
		req.payload?.logger?.error({
			err: error,
			msg: '[settings-overlay] access function threw; treating as denied',
		})
		return false
	}
}

export const passesOverlayAccess = (
	overlay: ResolvedOverlay,
	req: PayloadRequest
): Promise<boolean> => {
	const { access } = overlay
	return run(access ? () => access({ overlay, req }) : undefined, req)
}

export const passesItemAccess = (
	item: SettingsOverlayItem,
	req: PayloadRequest
): Promise<boolean> => {
	const { access } = item
	return run(access ? () => access({ item, req }) : undefined, req)
}

/**
 * An entity whose own `admin.hidden` was a function stays hidden inside the panel too: the
 * plugin overwrote that function at boot, so this is the only place left that can honour it.
 * Payload's semantics, so `true` means hidden. A predicate that throws fails closed.
 */
export const isHiddenForUser = (
	item: SettingsOverlayItem,
	req: PayloadRequest,
	hiddenPredicates: HiddenPredicates | undefined
): boolean => {
	if (!hiddenPredicates) {
		return false
	}
	const predicate =
		item.type === 'collection'
			? hiddenPredicates.collections?.[item.slug]
			: item.type === 'global'
				? hiddenPredicates.globals?.[item.slug]
				: undefined
	if (!predicate) {
		return false
	}
	try {
		return Boolean(predicate({ user: req.user }))
	} catch (error) {
		req.payload?.logger?.error({
			err: error,
			msg: '[settings-overlay] admin.hidden predicate threw; treating the entity as hidden',
		})
		return true
	}
}
