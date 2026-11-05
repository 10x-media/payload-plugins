/**
 * Names shared by the tracker, server ingest and the `/attributes` entry. Imports nothing, so every
 * one of those bundles can carry it.
 */

/** Goal slug a sale is booked against when `purchase` is given no other. */
export const PURCHASE_GOAL_SLUG = 'purchase'

/** Attribute auto-capture reads the goal slug from, on click and on submit. */
export const GOAL_ATTRIBUTE = 'data-analytics-goal'
/** Revenue for that one completion. Blank or non-numeric is absent, never zero. */
export const VALUE_ATTRIBUTE = 'data-analytics-value'
/** ISO 4217 code the value beside it is denominated in. */
export const CURRENCY_ATTRIBUTE = 'data-analytics-currency'
/** Custom event name auto-capture reads on click and on submit. */
export const EVENT_ATTRIBUTE = 'data-analytics-event'
/** Prefix for a custom event's props: `data-analytics-prop-plan="pro"` sends `plan: 'pro'`. */
export const EVENT_PROP_PREFIX = 'data-analytics-prop-'

/** Marks an element as a content item; its value is the item's ref, `<collection>:<id>`. */
export const ITEM_ATTRIBUTE = 'data-analytics-item'
/** The item's display name, forwarded to vendor slots only; native never stores it. */
export const ITEM_NAME_ATTRIBUTE = 'data-analytics-item-name'
/** Event name for the first click on an item during one pageview. */
export const ITEM_CLICK_EVENT = 'item_click'
/** Event name for a click on a link leaving the site. */
export const OUTBOUND_EVENT = 'outbound_link'
/** Event name for a click on a link whose target is a file. */
export const DOWNLOAD_EVENT = 'file_download'
/** Event name for a crossed scroll threshold; `props.depth` carries which one. */
export const SCROLL_EVENT = 'scroll_depth'
/** Seen items one engagement message carries; reaching it sends one early. */
export const MAX_ITEMS_PER_BEACON = 50
/** Longest ref ingest keeps, collection and encoded id together. */
export const MAX_ITEM_REF_LENGTH = 128
/**
 * Separates a ref from the signature the server wrote for it, `offers:12@<signature>`. A ref
 * never holds one itself: an id is written as `encodeURIComponent` writes it, `@` as `%40`.
 */
export const ITEM_SIGNATURE_SEPARATOR = '@'
/** Characters in an item signature, base64url. */
export const ITEM_SIGNATURE_LENGTH = 12
/**
 * The most engaged time one message may carry, 30 minutes: the tracker never sends more, and
 * ingest drops a longer one, so a tab left open in front cannot stretch an average for hours.
 */
export const MAX_ENGAGEMENT_MS = 1_800_000
/**
 * How long before it arrives an engagement may say its pageview was sent, 24 hours: the tracker
 * never sends more, and ingest files a longer claim when it arrives.
 */
export const MAX_SINCE_MS = 86_400_000

/** The action type form-builder stores as the block slug on a form's `actions` array. */
export const GOAL_ACTION_TYPE = 'analyticsGoal'
