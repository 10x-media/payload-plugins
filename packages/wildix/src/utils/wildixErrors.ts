/**
 * True when a WMS SDK error looks like a missing route (HTTP 404 with a
 * "404 Not Found" reason) rather than a missing call. On tenants without Call
 * Control v2 the entire `/api/v2/call-control/*` surface 404s this way, which is
 * the signal to fall back to the AMI `Originate` action for dialing.
 */
export const isRouteMissingError = (err: unknown): boolean => {
	const status = (err as { $metadata?: { httpStatusCode?: number } })?.$metadata?.httpStatusCode
	if (status === 404) return true
	const message = err instanceof Error ? err.message : String(err)
	return /404/.test(message) && /not\s*found/i.test(message)
}
