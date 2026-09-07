import type { SettingsOverlayItem, SortKey } from '../types'

/**
 * Stable ordering by a sort key, with declaration position as the tie-break.
 *
 * `undefined` means "leave where it was": entries without a key keep their relative order and
 * sit after every keyed entry. Numbers and strings compare within their own kind; a number
 * sorts before a string, so mixing the two is defined rather than merely tolerated.
 */
export const bySortKey = <T>(entries: T[], keyOf: (entry: T) => SortKey): T[] =>
	entries
		.map((entry, index) => ({ entry, index, key: keyOf(entry) }))
		.sort((a, b) => {
			if (a.key === undefined && b.key === undefined) {
				return a.index - b.index
			}
			if (a.key === undefined) {
				return 1
			}
			if (b.key === undefined) {
				return -1
			}
			if (typeof a.key === typeof b.key) {
				return a.key < b.key ? -1 : a.key > b.key ? 1 : a.index - b.index
			}
			return typeof a.key === 'number' ? -1 : 1
		})
		.map(({ entry }) => entry)

/** An item's own `order`, the sugar for the case where a sort function would be overkill. */
export const itemOrderKey = (item: SettingsOverlayItem): SortKey => item.order
