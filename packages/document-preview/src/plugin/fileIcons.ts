import type { Config, Endpoint, Field, FieldHook } from 'payload'
import { isImage } from 'payload/shared'
import { FILE_ICONS_VERSION, fileIconSvg } from '../shared/fileIcons'
import { fileKind, isFileKind } from '../shared/fileKind'
import { resolveMimeType } from '../shared/mime'

const ENDPOINT_PATH = '/document-preview/file-icon'

/** The URL a non-image upload's thumbnail points at, versioned so a redesign busts the cache. */
export const fileIconUrl = (apiRoute: string, kind: string): string =>
	`${apiRoute}${ENDPOINT_PATH}/${kind}?v=${FILE_ICONS_VERSION}`

/**
 * Fills `thumbnailURL` with a file-type icon when nothing else did. Runs after
 * Payload's own hook (merged field hooks concatenate), so image sizes, storage
 * adapters and a collection's `adminThumbnail` all keep precedence: only an
 * empty value on a non-image file is replaced.
 */
const fillIcon =
	(apiRoute: string): FieldHook =>
	({ siblingData, value }) => {
		if (value) {
			return value
		}
		const filename = typeof siblingData?.filename === 'string' ? siblingData.filename : ''
		if (!filename) {
			return value
		}
		// A `select` can leave `mimeType` out of the read, so the extension stands in for it.
		const stored = typeof siblingData?.mimeType === 'string' ? siblingData.mimeType : undefined
		const mimeType = resolveMimeType(stored, filename)
		if (isImage(mimeType)) {
			return value
		}
		return fileIconUrl(apiRoute, fileKind(mimeType, filename))
	}

/**
 * Declares only an afterRead hook on `thumbnailURL`, which Payload merges into
 * its upload field: type, visibility and its own hook stay as Payload defines
 * them. A collection that declares `thumbnailURL` itself keeps its settings and
 * gains the hook after its own.
 */
export const withFileIconThumbnail = (fields: Field[], apiRoute: string): Field[] => {
	const hook = fillIcon(apiRoute)
	const index = fields.findIndex((field) => 'name' in field && field.name === 'thumbnailURL')
	const existing = (index === -1 ? undefined : fields[index]) as
		| (Field & { hooks?: { afterRead?: FieldHook[] } })
		| undefined
	if (!existing) {
		return [...fields, { name: 'thumbnailURL', type: 'text', hooks: { afterRead: [hook] } }]
	}
	const merged = {
		...existing,
		hooks: { ...existing.hooks, afterRead: [...(existing.hooks?.afterRead ?? []), hook] },
	} as Field
	return fields.map((field, position) => (position === index ? merged : field))
}

/**
 * Serves the icons, to signed-in users only: they exist for the admin, and an
 * open endpoint would be a small public CDN on the host's bill. Cached privately
 * for a year; the version in the URL changes with the artwork.
 */
export const fileIconEndpoint: Endpoint = {
	handler: (req) => {
		if (!req.user) {
			return Response.json({ error: 'Unauthorized' }, { status: 401 })
		}
		const kind = req.routeParams?.kind
		if (typeof kind !== 'string' || !isFileKind(kind)) {
			return Response.json({ error: 'Not found' }, { status: 404 })
		}
		return new Response(fileIconSvg(kind), {
			headers: {
				'Cache-Control': 'private, max-age=31536000, immutable',
				'Content-Type': 'image/svg+xml; charset=utf-8',
			},
		})
	},
	method: 'get',
	path: `${ENDPOINT_PATH}/:kind`,
}

/** The configured REST route prefix, as Payload resolves it. */
export const apiRouteOf = (config: Config): string => config.routes?.api ?? '/api'
