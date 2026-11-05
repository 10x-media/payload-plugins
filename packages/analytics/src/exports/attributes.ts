import {
	CURRENCY_ATTRIBUTE,
	EVENT_ATTRIBUTE,
	EVENT_PROP_PREFIX,
	GOAL_ATTRIBUTE,
	ITEM_ATTRIBUTE,
	ITEM_NAME_ATTRIBUTE,
	ITEM_SIGNATURE_LENGTH,
	ITEM_SIGNATURE_SEPARATOR,
	MAX_ITEM_REF_LENGTH,
	VALUE_ATTRIBUTE,
} from '../goals/constants'

export {
	CURRENCY_ATTRIBUTE,
	DOWNLOAD_EVENT,
	EVENT_ATTRIBUTE,
	EVENT_PROP_PREFIX,
	GOAL_ATTRIBUTE,
	ITEM_ATTRIBUTE,
	ITEM_CLICK_EVENT,
	ITEM_NAME_ATTRIBUTE,
	MAX_ITEM_REF_LENGTH,
	MAX_ITEMS_PER_BEACON,
	OUTBOUND_EVENT,
	PURCHASE_GOAL_SLUG,
	SCROLL_EVENT,
	VALUE_ATTRIBUTE,
} from '../goals/constants'

/** What a JSX spread of these helpers produces: plain string attributes, nothing else. */
export type AnalyticsAttributes = Record<string, string>

const MAX_PROPS = 20
const MAX_VALUE_LENGTH = 256

/**
 * Same normalization as the root entry's `goalSlug`, repeated so this module pulls in neither
 * Payload nor React.
 */
const slugOf = (value: unknown): string | null => {
	const raw: unknown =
		typeof value === 'object' && value !== null && !Array.isArray(value)
			? Reflect.get(value, 'slug')
			: value
	const slug = typeof raw === 'string' ? raw.trim() : ''
	return slug === '' ? null : slug
}

const amount = (value: unknown): string | undefined =>
	typeof value === 'number' && Number.isFinite(value) ? String(value) : undefined

/**
 * Makes any element a goal completion: auto-capture reads the nearest tagged ancestor on click or
 * submit. DOM-free for server components; an unset goal spreads to nothing.
 */
export const goalAttributes = (
	goal: unknown,
	opts?: { value?: number; currency?: string }
): AnalyticsAttributes => {
	const slug = slugOf(goal)
	if (!slug) {
		return {}
	}
	const value = amount(opts?.value)
	return {
		[GOAL_ATTRIBUTE]: slug,
		...(value === undefined ? {} : { [VALUE_ATTRIBUTE]: value }),
		...(opts?.currency ? { [CURRENCY_ATTRIBUTE]: opts.currency } : {}),
	}
}

/**
 * Custom-event variant: `eventAttributes('cta_click', { plan: 'pro' })` tracks on click or submit.
 * Props ride as `data-analytics-prop-*`, trimmed to the twenty short scalars ingest keeps.
 */
export const eventAttributes = (
	name: unknown,
	props?: Record<string, unknown>
): AnalyticsAttributes => {
	const eventName = typeof name === 'string' ? name.trim() : ''
	if (eventName === '') {
		return {}
	}
	const out: AnalyticsAttributes = { [EVENT_ATTRIBUTE]: eventName }
	let kept = 0
	for (const [key, value] of Object.entries(props ?? {})) {
		if (kept >= MAX_PROPS || key.trim() === '') {
			continue
		}
		if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
			out[`${EVENT_PROP_PREFIX}${key}`] = String(value).slice(0, MAX_VALUE_LENGTH)
			kept++
		}
	}
	return out
}

/**
 * `<collection>:<id>` ref for a document shown on other pages, id URI-encoded; undefined without an
 * id or past ingest's cap. Unsigned, so native keeps it only where signatures are optional.
 */
export const itemRef = (
	collection: string,
	id: string | number | null | undefined
): string | undefined => {
	const slug = collection.trim()
	if (slug === '' || id === null || id === undefined || String(id) === '') {
		return undefined
	}
	const ref = `${slug}:${encodeURIComponent(String(id))}`
	return ref.length > MAX_ITEM_REF_LENGTH ? undefined : ref
}

/** Longest item value a page carries: a ref and its signature. */
const MAX_ITEM_VALUE_LENGTH =
	MAX_ITEM_REF_LENGTH + ITEM_SIGNATURE_SEPARATOR.length + ITEM_SIGNATURE_LENGTH

/** An item by its document, written unsigned. */
export interface ItemByDocument {
	collection: string
	id: string | number | null | undefined
	name?: string | null
}

/** An item by a ref the server already wrote, signed by `signItemRef` from the root entry. */
export interface ItemBySignedRef {
	ref: string | null | undefined
	name?: string | null
}

/**
 * A value that can be a ref, signed or not: shaped `<collection>:<id>`, within the cap. Ingest and
 * the tracker check the rest; this entry only refuses to write what could never be kept.
 */
const itemValue = (value: string | null | undefined): string | undefined => {
	const trimmed = typeof value === 'string' ? value.trim() : ''
	return trimmed.indexOf(':') > 0 && trimmed.length <= MAX_ITEM_VALUE_LENGTH ? trimmed : undefined
}

/**
 * Marks a content item: seen once half stays on screen for a second, clicked on any inner click.
 * Native keeps it only under a server-signed ref (`signItemRef`); `name` reaches vendor slots only.
 */
export const itemAttributes = (item: ItemByDocument | ItemBySignedRef): AnalyticsAttributes => {
	const ref = 'ref' in item ? itemValue(item.ref) : itemRef(item.collection, item.id)
	if (ref === undefined) {
		return {}
	}
	const name = typeof item.name === 'string' ? item.name.trim().slice(0, MAX_VALUE_LENGTH) : ''
	return {
		[ITEM_ATTRIBUTE]: ref,
		...(name === '' ? {} : { [ITEM_NAME_ATTRIBUTE]: name }),
	}
}
