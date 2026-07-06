import type { CollectionConfig } from 'payload'
import { deepMerge } from 'payload'
import { isLoggedIn } from '../plugin/access'

export const FORM_UPLOADS_SLUG = 'form-uploads'

/** Override surface for the built-in upload collection. */
export type UploadsCollectionConfig = {
	slug?: string
	/** Merged onto the collection's `upload` config (e.g. `staticDir`, `mimeTypes`). `true` uses Payload defaults. */
	upload?: NonNullable<CollectionConfig['upload']> | true
	/** Replace access (defaults: anonymous create, authed read/update/delete). */
	access?: CollectionConfig['access']
	/** Append extra fields. */
	fields?: CollectionConfig['fields']
}

export type UploadsOption = boolean | UploadsCollectionConfig

/**
 * The built-in upload collection backing the `file` field. Anonymous create (public forms upload here),
 * authed read/update/delete (only admins read stored files; submitters cannot enumerate others' uploads).
 * Per-field MIME/size is re-enforced at submit, so the collection stays permissive by default. No
 * `imageSizes`, so it needs no `sharp`. Projects with their own upload collection set `uploads: false` and
 * point the file field's `relationTo` at theirs.
 */
export const buildUploadsCollection = (
	config: UploadsCollectionConfig = {},
	overrides?: Partial<CollectionConfig>
): CollectionConfig => {
	const defaults: CollectionConfig = {
		slug: config.slug ?? FORM_UPLOADS_SLUG,
		access: config.access ?? {
			create: () => true,
			read: isLoggedIn,
			update: isLoggedIn,
			delete: isLoggedIn,
		},
		admin: { group: 'Forms' },
		upload: config.upload && config.upload !== true ? config.upload : true,
		fields: [
			{ name: 'owner', type: 'text', admin: { readOnly: true, hidden: true } },
			...(config.fields ?? []),
		],
	}
	return overrides ? deepMerge(defaults, overrides) : defaults
}

/** Resolve the `uploads` plugin option: `false` disables, `true`/object enables the built-in collection. */
export const resolveUploads = (
	option: UploadsOption | undefined
): { enabled: boolean; slug: string; collection?: CollectionConfig } => {
	if (option === false) {
		return { enabled: false, slug: FORM_UPLOADS_SLUG }
	}
	const config = option && option !== true ? option : {}
	const collection = buildUploadsCollection(config)
	return { enabled: true, slug: collection.slug as string, collection }
}
