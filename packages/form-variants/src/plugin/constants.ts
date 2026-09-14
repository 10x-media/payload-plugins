/** Where the plugin parks its resolved config. `custom` is in Payload's server-only properties. */
export const REGISTRY_KEY = '@10x-media/form-variants'

/** The key on a collection's `custom` that carries its variants. */
export const COLLECTION_CUSTOM_KEY = 'formVariants'

/** The variant key reserved for Payload's own edit view. */
export const NATIVE_KEY = 'native'

/** Full-page query parameters. Neither exists in a drawer. */
export const VARIANT_PARAM = 'variant'
export const STEP_PARAM = 'step'

/** Path of the plugin's evaluate endpoint, below the API route. */
export const EVALUATE_PATH = '/form-variants/evaluate'

export const VIEW_PATH = '@10x-media/form-variants/rsc#VariantEditView'

/** Prefix for the `admin.dependencies` entries the plugin creates for configured components. */
export const DEPENDENCY_PREFIX = 'form-variants'

/** The stored variant choice, distinct from Payload's own `collection-<slug>` preferences. */
export const preferenceKeyFor = (collectionSlug: string): string =>
	`form-variants-${collectionSlug}`

/** CSS block name every plugin class derives from. */
export const BASE_CLASS = 'form-variants'
