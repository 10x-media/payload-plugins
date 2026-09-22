export type MetadataSet = 'max' | 'min' | 'mobile'

/** Opaque libphonenumber metadata; only the library itself reads its shape. */
export type PhoneMetadata = Readonly<Record<string, unknown>>

/** The only set carrying per-type patterns, so the only one supporting getType(). */
export const DEFAULT_METADATA_SET: MetadataSet = 'max'

/**
 * Static map of dynamic imports rather than a computed specifier, so bundlers can
 * split all three sets and ship only the one an install selects.
 */
const loaders: Record<MetadataSet, () => Promise<{ default: PhoneMetadata }>> = {
	max: () => import('libphonenumber-js/metadata.max.json'),
	min: () => import('libphonenumber-js/metadata.min.json'),
	mobile: () => import('libphonenumber-js/metadata.mobile.json'),
}

const cache = new Map<MetadataSet, Promise<PhoneMetadata>>()

/** A rejection is evicted so a later call retries instead of inheriting the failure. */
export const loadMetadata = (set: MetadataSet): Promise<PhoneMetadata> => {
	const cached = cache.get(set)
	if (cached) return cached
	const loader = loaders[set]
	// An out-of-union set arrives from unvalidated config; rejecting rather than throwing keeps
	// every caller's degrade path in charge instead of taking the render down with it.
	if (!loader) return Promise.reject(new Error(`unknown phone metadata set "${String(set)}"`))
	const loading = loader()
		.then((module) => module.default)
		.catch((err: unknown) => {
			cache.delete(set)
			throw err
		})
	cache.set(set, loading)
	return loading
}
