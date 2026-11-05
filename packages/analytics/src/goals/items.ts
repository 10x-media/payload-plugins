import { isRecord } from '../core/values'
import type { RevenueItem } from '../tracker/config'

/** Lines past this are a catalogue dump rather than an order, and props are a bounded column. */
const MAX_REVENUE_ITEMS = 20

const MAX_ITEM_STRING = 128

const text = (value: unknown): string | undefined =>
	typeof value === 'string' && value.trim() !== '' ? value.slice(0, MAX_ITEM_STRING) : undefined

const amount = (value: unknown): number | undefined =>
	typeof value === 'number' && Number.isFinite(value) ? value : undefined

/**
 * A sale's lines as stored and forwarded: the first {@link MAX_REVENUE_ITEMS}, capped, malformed or
 * id-less ones dropped rather than failing the sale; none left is no `items` at all.
 */
export const sanitizeItems = (raw: unknown): RevenueItem[] | undefined => {
	if (!Array.isArray(raw)) {
		return undefined
	}
	const out: RevenueItem[] = []
	for (const line of raw) {
		if (out.length >= MAX_REVENUE_ITEMS) {
			break
		}
		if (!isRecord(line) || Array.isArray(line)) {
			continue
		}
		const id = text(line.id)
		if (id === undefined) {
			continue
		}
		const name = text(line.name)
		const quantity = amount(line.quantity)
		const price = amount(line.price)
		out.push({
			id,
			...(name === undefined ? {} : { name }),
			...(quantity === undefined ? {} : { quantity }),
			...(price === undefined ? {} : { price }),
		})
	}
	return out.length > 0 ? out : undefined
}
