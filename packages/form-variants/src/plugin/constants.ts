/** Where the plugin parks its resolved config. `custom` is in Payload's server-only properties. */
export const REGISTRY_KEY = '@10x-media/form-variants'

/** The key on a collection's `custom` that carries its variants. */
export const COLLECTION_CUSTOM_KEY = 'formVariants'

/** The variant key reserved for Payload's own edit view. */
export const NATIVE_KEY = 'native'

/** The full page's one query parameter. It does not exist in a drawer. */
export const VARIANT_PARAM = 'variant'

/** Path of the plugin's evaluate endpoint, below the API route. */
export const EVALUATE_PATH = '/form-variants/evaluate'

export const VIEW_PATH = '@10x-media/form-variants/rsc#VariantEditView'

/** Prefix for the `admin.dependencies` entries the plugin creates for configured components. */
export const DEPENDENCY_PREFIX = 'form-variants'

/** The stored variant choice, distinct from Payload's own `collection-<slug>` preferences. */
export const preferenceKeyFor = (collectionSlug: string): string =>
	`form-variants-${collectionSlug}`

/**
 * Payload's own per-document preferences, where the open step is remembered next to the tab
 * and collapsible state of the same document. Payload deletes this row with the document and
 * writes it by spreading what it finds, so the plugin's property survives its writes and
 * leaves nothing behind.
 */
export const docPreferenceKeyFor = (collectionSlug: string, id: number | string): string =>
	`collection-${collectionSlug}-${id}`

/** The property the plugin adds to those preferences, beside Payload's own `fields`. */
export const DOC_PREFERENCE_PROPERTY = 'formVariants'

/** CSS block name every plugin class derives from. */
export const BASE_CLASS = 'form-variants'
