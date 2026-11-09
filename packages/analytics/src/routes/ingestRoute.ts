import type { SanitizedConfig } from 'payload'
import type { IngestRouteOptions } from '../native/ingest/route'

export type { IngestRouteOptions } from '../native/ingest/route'

/** Loaded on the first request, so importing this entry, as a `next.config` may, never loads Payload. */
const loadIngestRoute = () => import('../native/ingest/route')

/**
 * A Next.js POST handler for native beacons at the tracker's `ingestPath`, with every ingest rule
 * applied but without Payload's REST routing and auth strategies.
 */
export const ingestRoute =
	(
		config: Promise<SanitizedConfig> | SanitizedConfig,
		options: IngestRouteOptions = {}
	): ((request: Request) => Promise<Response>) =>
	async (request) =>
		(await loadIngestRoute()).receiveBeacon(request, config, options)

/**
 * The `OPTIONS` handler beside {@link ingestRoute}, for pages on another domain: only an origin
 * `capture.allowedOrigins` lists passes the browser's preflight.
 */
export const ingestPreflight =
	(
		config: Promise<SanitizedConfig> | SanitizedConfig,
		options: IngestRouteOptions = {}
	): ((request: Request) => Promise<Response>) =>
	async (request) =>
		(await loadIngestRoute()).answerPreflight(request, config, options)
