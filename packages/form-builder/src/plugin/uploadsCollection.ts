import type { CollectionConfig, Config, Field } from 'payload'
import type { ResolvedSpamConfig } from '../spam/types'
import { buildUploadOwnerStamp, buildUploadRateLimit } from '../spam/uploadHooks'

/**
 * Uploads are bring-your-own: `false` (the default) disables file fields entirely, an object points
 * at a host-owned upload collection (created by the app with its storage adapter of choice).
 * `mimeTypes` optionally constrains the file field's MIME picker for hosts that enforce types by other
 * means than the collection's own `upload.mimeTypes` (which is read automatically when this is absent).
 */
export type UploadsOption = false | { collection: string; mimeTypes?: string[] }

/**
 * The MIME types the file field's picker should offer: the host upload collection's own
 * `upload.mimeTypes`, or undefined (no constraint, so the picker keeps its full list). Read at
 * plugin-factory time, before the field registry freezes; `attachUploadsCollection` runs too late.
 */
export const readUploadCollectionMimeTypes = (
	config: Config,
	slug: string
): string[] | undefined => {
	const target = config.collections?.find((collection) => collection.slug === slug)
	const upload = target?.upload
	return typeof upload === 'object' && Array.isArray(upload.mimeTypes)
		? upload.mimeTypes
		: undefined
}

/** Descends presentational rows only: an `owner` field nested in a group/tabs/collapsible is not detected, so a top-level one gets appended alongside it. */
const hasFieldNamed = (fields: Field[], name: string): boolean =>
	fields.some((field) => {
		if ('name' in field && field.name === name) {
			return true
		}
		return field.type === 'row' && hasFieldNamed(field.fields, name)
	})

type AttachUploadsCollectionArgs = {
	config: Config
	slug: string
	spam: ResolvedSpamConfig | false
}

/**
 * Wire the plugin's upload concerns into the host-owned upload collection named by
 * `uploads.collection`. The collection must already exist in `config.collections` and carry an
 * `upload` config; anything else is a plugin misconfiguration and throws at boot. The plugin
 * appends its hidden `owner` text field unless the host already defines a field named `owner`
 * (then that field is reused and must stay a text-compatible identity slot), and prepends the
 * spam upload hooks (rate limit, owner stamp) ahead of the host's own hooks so abuse checks run
 * first. The host entry is replaced with a new object; the host's config is never mutated.
 */
export const attachUploadsCollection = ({
	config,
	slug,
	spam,
}: AttachUploadsCollectionArgs): void => {
	const collections = config.collections ?? []
	const target = collections.find((collection) => collection.slug === slug)
	if (!target) {
		throw new Error(
			`@10x-media/form-builder: uploads.collection "${slug}" was not found in config.collections. ` +
				`Create an upload-enabled collection (with your storage adapter) and pass its slug, ` +
				`e.g. formBuilder({ uploads: { collection: 'media' } }).`
		)
	}
	if (!target.upload) {
		throw new Error(
			`@10x-media/form-builder: uploads.collection "${slug}" has no \`upload\` config. ` +
				`File fields store Payload uploads, so the collection must be an upload collection ` +
				`(set \`upload: true\` or an upload options object on it).`
		)
	}

	const fields = hasFieldNamed(target.fields, 'owner')
		? target.fields
		: [
				...target.fields,
				{ name: 'owner', type: 'text', admin: { readOnly: true, hidden: true } } as Field,
			]

	const attached: CollectionConfig = {
		...target,
		fields,
		...(spam
			? {
					hooks: {
						...(target.hooks ?? {}),
						beforeOperation: [buildUploadRateLimit(spam), ...(target.hooks?.beforeOperation ?? [])],
						beforeValidate: [buildUploadOwnerStamp(spam), ...(target.hooks?.beforeValidate ?? [])],
					},
				}
			: {}),
	}

	config.collections = collections.map((collection) =>
		collection.slug === slug ? attached : collection
	)
}
