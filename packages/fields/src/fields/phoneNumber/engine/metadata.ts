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
	const loading = loaders[set]()
		.then((module) => module.default)
		.catch((err: unknown) => {
			cache.delete(set)
			throw err
		})
	cache.set(set, loading)
	return loading
}
