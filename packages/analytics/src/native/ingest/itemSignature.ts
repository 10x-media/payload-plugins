import type { Payload } from 'payload'
import { type AnalyticsAttributes, itemAttributes } from '../../exports/attributes'
import { ITEM_SIGNATURE_SEPARATOR } from '../../goals/constants'
import { itemIdTypeOf } from '../../items/collectionIdType'
import { fitsIdType } from '../../items/idType'
import { itemRefOf, parseItemValue } from '../../items/ref'
import { labelledKey, sameSignature, shortSignature } from './signature'

/**
 * `required` (default) keeps only server-signed refs, so a page script cannot invent items;
 * `optional` also keeps unsigned ones, for a site that cannot sign where it writes refs.
 */
export type ItemSignatureMode = 'required' | 'optional'

export interface ItemSignatureCheck {
	mode: ItemSignatureMode
	key: Buffer
}

/** The key item refs are signed with, derived from the instance's secret. */
export const itemRefKey = labelledKey('analytics:item-ref:v1')

/** The signature of one ref: 72 bits of its HMAC, base64url. */
export const itemRefSignature = (key: Buffer, ref: string): string => shortSignature(key, ref)

/**
 * Ref ingest may keep: a signed value only with the server's signature, an unsigned one only when
 * signatures are optional or the event is trusted server code.
 */
export const verifiedItemRef = (
	value: unknown,
	check: ItemSignatureCheck | undefined,
	trusted: boolean
): string | undefined => {
	const parsed = parseItemValue(value)
	if (!parsed) {
		return undefined
	}
	if (parsed.signature === undefined) {
		return trusted || check?.mode === 'optional' ? parsed.ref : undefined
	}
	return check && sameSignature(itemRefSignature(check.key, parsed.ref), parsed.signature)
		? parsed.ref
		: undefined
}

/**
 * `data-analytics-item` value for a document (`offers:12@<signature>`), undefined for an id the
 * collection cannot hold. Call it during server rendering; the browser never sees the key.
 */
export const signItemRef = (
	payload: Payload,
	collection: string,
	id: string | number | null | undefined
): string | undefined => {
	const slug = collection.trim()
	const ref = slug === '' ? undefined : itemRefOf(slug, id)
	if (ref === undefined || !fitsIdType(String(id), itemIdTypeOf(payload, slug))) {
		return undefined
	}
	return `${ref}${ITEM_SIGNATURE_SEPARATOR}${itemRefSignature(itemRefKey(payload.secret), ref)}`
}

/**
 * `itemAttributes` with a signed ref, to spread on the element showing the item in a server
 * component. Spreads to nothing for an item {@link signItemRef} cannot sign.
 */
export const itemAttributesFor = (
	payload: Payload,
	item: { collection: string; id: string | number | null | undefined; name?: string | null }
): AnalyticsAttributes => {
	const ref = signItemRef(payload, item.collection, item.id)
	return ref === undefined ? {} : itemAttributes({ ref, name: item.name })
}
