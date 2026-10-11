import {
	ITEM_CLICK_EVENT,
	ITEM_SIGNATURE_LENGTH,
	ITEM_SIGNATURE_SEPARATOR,
	MAX_ITEM_REF_LENGTH,
} from '../goals/constants'
import { fitsIdType, type ItemIdType } from './idType'

/** A ref split into its collection and its id, the id still URI-encoded as the ref carries it. */
export interface ItemRefParts {
	collection: string
	id: string
}

/**
 * Parts of a well-formed ref (`<collection>:<id>` within the length cap, id exactly as
 * `encodeURIComponent` writes it, so no document counts under two spellings), or null.
 */
export const parseItemRef = (value: unknown): ItemRefParts | null => {
	if (typeof value !== 'string' || value.length > MAX_ITEM_REF_LENGTH) {
		return null
	}
	const colon = value.indexOf(':')
	if (colon <= 0 || colon === value.length - 1) {
		return null
	}
	const collection = value.slice(0, colon)
	const id = value.slice(colon + 1)
	let decoded: string
	try {
		decoded = decodeURIComponent(id)
	} catch {
		return null
	}
	return encodeURIComponent(decoded) === id ? { collection, id } : null
}

/** An item value as a page carries it: a ref, and the signature the server wrote for it if any. */
export interface ItemValue {
	ref: string
	signature?: string
}

const SIGNATURE = new RegExp(`^[A-Za-z0-9_-]{${ITEM_SIGNATURE_LENGTH}}$`)

/** Whether `value` has the shape of a signature the server writes; no key has checked it yet. */
export const isSignatureShaped = (value: string): boolean => SIGNATURE.test(value)

/**
 * The parts of an item value, `<ref>` or `<ref>@<signature>`, or null when either part is
 * malformed. The last `@` separates them, since a ref writes its own as `%40`.
 */
export const parseItemValue = (value: unknown): ItemValue | null => {
	if (typeof value !== 'string') {
		return null
	}
	const at = value.lastIndexOf(ITEM_SIGNATURE_SEPARATOR)
	if (at === -1) {
		return parseItemRef(value) ? { ref: value } : null
	}
	const ref = value.slice(0, at)
	const signature = value.slice(at + 1)
	return isSignatureShaped(signature) && parseItemRef(ref) ? { ref, signature } : null
}

/** An item value without its signature: what a vendor slot is sent, and what native stores. */
export const bareItemRef = (value: string): string => {
	const at = value.lastIndexOf(ITEM_SIGNATURE_SEPARATOR)
	return at === -1 ? value : value.slice(0, at)
}

/** The document id a ref names, decoded back to what the collection stores. */
export const itemDocumentId = (parts: ItemRefParts): string => decodeURIComponent(parts.id)

/**
 * The ref a document is counted under, as `itemRef` in the attributes entry writes it. That
 * entry repeats this rather than importing it, to keep its promise of importing nothing.
 */
export const itemRefOf = (collection: string, id: unknown): string | undefined => {
	if ((typeof id !== 'string' && typeof id !== 'number') || String(id) === '') {
		return undefined
	}
	const ref = `${collection}:${encodeURIComponent(String(id))}`
	return ref.length > MAX_ITEM_REF_LENGTH ? undefined : ref
}

/**
 * The ref when well-formed, bound as items and its id fitting (any id when its collection is
 * missing from `idTypes`). Config alone decides, so a public beacon never costs a database read.
 */
export const boundItemRef = (
	value: unknown,
	collections: ReadonlySet<string>,
	idTypes?: ReadonlyMap<string, ItemIdType>
): string | undefined => {
	const parts = parseItemRef(value)
	if (!parts || !collections.has(parts.collection)) {
		return undefined
	}
	const idType = idTypes?.get(parts.collection)
	if (idType !== undefined && !fitsIdType(itemDocumentId(parts), idType)) {
		return undefined
	}
	return `${parts.collection}:${parts.id}`
}

/**
 * Whether an event is a click on an item: the one kind of hit that counts as an interaction,
 * in a day's totals and in a read of raw hits alike, so the two cannot disagree.
 */
export const isItemClick = (event: {
	type: string
	name?: string | null
	item?: string | null
}): boolean =>
	event.type === 'event' &&
	event.name === ITEM_CLICK_EVENT &&
	typeof event.item === 'string' &&
	event.item !== ''
