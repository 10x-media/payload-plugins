import { formatAdminURL } from 'payload/shared'

export type EndpointOption = { label: string; value: string }

/**
 * URL for a document-scoped collection endpoint (`{api}/{collection}/{id}/{endpoint}`), built the
 * way Payload's own admin components build fetch URLs: `formatAdminURL` over `config.routes.api`,
 * which handles a Next `basePath` and returns a same-origin relative URL so the admin cookie rides
 * along without CORS concerns.
 */
export const buildEndpointOptionsUrl = (args: {
	apiRoute: string
	collectionSlug: string
	id: number | string
	endpoint: string
}): string =>
	formatAdminURL({
		apiRoute: args.apiRoute,
		path: `/${args.collectionSlug}/${encodeURIComponent(String(args.id))}/${args.endpoint.replace(/^\/+/, '')}`,
	})

/**
 * Narrow an endpoint response to `{ options }`. Entries without a string value are dropped and
 * labels fall back to the value; a body without an options array throws so the select surfaces its
 * error state instead of silently rendering empty.
 */
export const parseEndpointOptions = (body: unknown): EndpointOption[] => {
	const options =
		body != null && typeof body === 'object' ? (body as { options?: unknown }).options : undefined
	if (!Array.isArray(options)) {
		throw new Error('Malformed options response: expected { options: [] }')
	}
	return options
		.filter(
			(option): option is { label?: unknown; value: string } =>
				option != null && typeof option === 'object' && typeof option.value === 'string'
		)
		.map((option) => ({
			value: option.value,
			label:
				typeof option.label === 'string' && option.label.length > 0 ? option.label : option.value,
		}))
}
