import { formatAdminURL } from 'payload/shared'

/** The slice of a Payload config, server or client, the plugin's paths are built from. */
export interface ApiPathConfigSource {
	routes?: { api?: string | undefined } | undefined
}

const isRooted = (path: string): path is `/${string}` => path.startsWith('/')

const rooted = (path: string): `/${string}` => (isRooted(path) ? path : `/${path}`)

/**
 * A relative path under the app's `routes.api`, behind the Next `basePath` `withPayload` publishes,
 * built the way Payload's own admin builds its fetches.
 */
export const apiPath = (config: ApiPathConfigSource, path: string): string =>
	formatAdminURL({ apiRoute: config.routes?.api ?? '/api', path: rooted(path), relative: true })

/** An app path behind the Next `basePath`, for a mount the host serves through Next rewrites. */
export const appPath = (path: string): string =>
	formatAdminURL({ apiRoute: '', path: rooted(path), relative: true })
