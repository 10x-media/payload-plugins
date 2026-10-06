import type { PayloadRequest, SanitizedPermissions } from 'payload'

import type { ResolvedOverlay } from '../plugin/resolveOptions'
import type {
	CollectionItem,
	HiddenPredicates,
	LocalizedLabel,
	Manifest,
	ManifestGroup,
	ManifestItem,
	SettingsOverlayItem,
} from '../types'
import { isHiddenForUser, passesItemAccess } from './access'
import { type EntityLookup, resolveItemGroup, resolveItemLabel } from './entityLabels'
import { bySortKey, itemOrderKey } from './sort'

const canRead = (item: SettingsOverlayItem, permissions: SanitizedPermissions): boolean => {
	if (item.type === 'collection') {
		return permissions?.collections?.[item.slug]?.read === true
	}
	if (item.type === 'global') {
		return permissions?.globals?.[item.slug]?.read === true
	}
	return true
}

const isVisible = async (args: {
	hiddenPredicates: HiddenPredicates | undefined
	item: SettingsOverlayItem
	permissions: SanitizedPermissions
	req: PayloadRequest
}): Promise<boolean> => {
	const { hiddenPredicates, item, permissions, req } = args
	if (!canRead(item, permissions)) {
		return false
	}
	if (!(await passesItemAccess(item, req))) {
		return false
	}
	return !isHiddenForUser(item, req, hiddenPredicates)
}

/**
 * The document a collection item with `resolveDocID` should open, or `undefined` when the
 * item behaves like an ordinary list. A resolver that throws falls back to the list rather
 * than removing the row: the reader can still get at the collection.
 */
const resolveDirectDocID = async (
	item: CollectionItem,
	req: PayloadRequest
): Promise<'new' | string | undefined> => {
	if (!item.resolveDocID) {
		return undefined
	}
	try {
		const resolved = await item.resolveDocID({ item, req })
		if (resolved === null) {
			return undefined
		}
		// The resolver speaks Payload's route vocabulary, where the create form is `create`. The
		// panel's is the URL it writes, where it is `new`. Translating here keeps both honest and
		// means the browser only ever sees the token it acts on.
		return resolved === 'create' ? 'new' : resolved
	} catch (error) {
		req.payload?.logger?.error({
			err: error,
			msg: `[settings-overlay] resolveDocID threw for item "${item.slug}"; falling back to the list`,
		})
		return undefined
	}
}

/**
 * The rail for one overlay and one reader: only what they may open, grouped, sorted, with the
 * ungrouped block first so the reading order matches the config's.
 *
 * This is the only inventory the browser ever receives. Nothing is filtered client-side, so
 * an item the reader may not open never leaves the server in any form.
 */
export const buildManifest = async (args: {
	entities: EntityLookup
	/** The reader's collapsed groups for this overlay, keyed by group label. */
	groupPrefs?: Record<string, { open?: boolean }>
	hiddenPredicates?: HiddenPredicates
	locale: string
	overlay: ResolvedOverlay
	permissions: SanitizedPermissions
	req: PayloadRequest
	translate: (label: LocalizedLabel) => string
}): Promise<Manifest> => {
	const { entities, groupPrefs, hiddenPredicates, locale, overlay, permissions, req, translate } =
		args

	const visibility = await Promise.all(
		overlay.items.map((item) => isVisible({ hiddenPredicates, item, permissions, req }))
	)
	const visible = overlay.items.filter((_, index) => visibility[index])

	const directDocIDs = await Promise.all(
		visible.map((item) =>
			item.type === 'collection' ? resolveDirectDocID(item, req) : Promise.resolve(undefined)
		)
	)

	const ungrouped: ManifestGroup = { items: [], label: null }
	const grouped = new Map<string, ManifestGroup>()
	const itemsByGroupLabel = new Map<null | string, SettingsOverlayItem[]>()

	visible.forEach((item, index) => {
		const manifestItem: ManifestItem = {
			label: translate(resolveItemLabel(item, entities)),
			slug: item.slug,
			type: item.type,
			...(item.badge ? { badge: item.badge } : {}),
			...(item.keywords?.length ? { keywords: item.keywords } : {}),
			...(item.type === 'link' ? { href: item.href } : {}),
			...(directDocIDs[index] ? { directDocID: directDocIDs[index] } : {}),
		}

		const group = resolveItemGroup(item, entities)
		const label = group === undefined ? null : translate(group)

		const bucket = label === null ? ungrouped : (grouped.get(label) ?? { items: [], label })
		bucket.items.push(manifestItem)
		if (label !== null) {
			grouped.set(label, bucket)
		}

		itemsByGroupLabel.set(label, [...(itemsByGroupLabel.get(label) ?? []), item])
	})

	const groups = [...(ungrouped.items.length ? [ungrouped] : []), ...grouped.values()]

	const sortedGroups = overlay.sort?.groups
		? bySortKey(groups, (group) => overlay.sort?.groups?.({ label: group.label }, { locale }))
		: groups

	const sorted = sortedGroups.map((group) => {
		const sourceItems = itemsByGroupLabel.get(group.label) ?? []
		const keyOf = (manifestItem: ManifestItem): ReturnType<typeof itemOrderKey> => {
			const source = sourceItems.find((item) => item.slug === manifestItem.slug)
			if (!source) {
				return undefined
			}
			return overlay.sort?.items
				? overlay.sort.items(source, { label: group.label }, { locale })
				: itemOrderKey(source)
		}
		const stored = group.label === null ? undefined : groupPrefs?.[group.label]?.open
		return {
			...group,
			items: bySortKey(group.items, keyOf),
			...(stored === false ? { open: false } : {}),
		}
	})

	return {
		groups: sorted,
		id: overlay.id,
		label: translate(overlay.label),
	}
}
