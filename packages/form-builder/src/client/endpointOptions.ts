import { formatAdminURL } from 'payload/shared'

export type EndpointOption = { label: string; value: string }

/**
 * What an endpoint-backed select's options depend on. `'document'` (the default) needs a saved
 * document: the URL carries the id and the fetch waits for one. `'request'` means the server
 * resolves options from the request alone (tenant, locale, auth), so the URL has no id segment
 * and the options load while the document is still being created.
 */
export type EndpointOptionsScope = 'document' | 'request'

/**
 * URL for a collection endpoint serving select options, built the way Payload's own admin
 * components build fetch URLs: `formatAdminURL` over `config.routes.api`, which handles a Next
 * `basePath` and returns a same-origin relative URL so the admin cookie rides along without CORS
 * concerns. Document scope yields `{api}/{collection}/{id}/{endpoint}`; request scope yields
 * `{api}/{collection}/{endpoint}`.
 */
export const buildEndpointOptionsUrl = (args: {
	apiRoute: string
	collectionSlug: string
	id?: number | string
	endpoint: string
	scope?: EndpointOptionsScope
}): string => {
	const endpoint = args.endpoint.replace(/^\/+/, '')
	const path: `/${string}` =
		args.scope === 'request'
			? `/${args.collectionSlug}/${endpoint}`
			: `/${args.collectionSlug}/${encodeURIComponent(String(args.id))}/${endpoint}`
	return formatAdminURL({ apiRoute: args.apiRoute, path })
}

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
