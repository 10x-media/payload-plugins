import type { PayloadRequest } from 'payload'
import { isHostname, normalizeHostname, requestHostname } from './requestHost'

/**
 * Hostname to store an event under; null or a non-hostname drops it. `claimed` is untrusted body
 * input. Not the binding `HostnameResolver`, which names where a document is read.
 */
export type EventHostnameResolver = (args: {
	claimed: string | undefined
	req: PayloadRequest
	scope: string | null
}) => string | null | Promise<string | null>

/**
 * `'request'` stores the request's host; a list stores it only when listed, for a single-site
 * install behind no host validation; a function decides for itself.
 */
export type HostnameOption = 'request' | string[] | EventHostnameResolver

export type ResolvedHostnameOption =
	| { kind: 'request' }
	| { kind: 'list'; hosts: ReadonlySet<string> }
	| { kind: 'resolver'; resolve: EventHostnameResolver }

/**
 * Config-time list validation, lowercased so the ingest compare is exact. Ports are not stripped:
 * an entry carrying one would be accepted and then never match what is stored.
 */
export const hostnameSet = (values: string[] | undefined, option: string): ReadonlySet<string> => {
	const hosts = new Set<string>()
	for (const value of values ?? []) {
		const host = typeof value === 'string' ? value.trim().toLowerCase().replace(/\.+$/, '') : ''
		if (!isHostname(host)) {
			throw new Error(
				`analytics: ${option} entries must each be a bare hostname, got "${String(value)}"`
			)
		}
		hosts.add(host)
	}
	return hosts
}

/** The `hostname` option checked at config time, in the shape ingest reads it. */
export const resolveHostnameOption = (
	option: HostnameOption | undefined
): ResolvedHostnameOption => {
	if (option === undefined || option === 'request') {
		return { kind: 'request' }
	}
	if (typeof option === 'function') {
		return { kind: 'resolver', resolve: option }
	}
	if (!Array.isArray(option)) {
		throw new Error(
			`analytics: hostname must be "request", a list of hostnames, or a resolver, got ${typeof option}`
		)
	}
	if (option.length === 0) {
		throw new Error('analytics: hostname must name at least one hostname, or every event drops')
	}
	return { kind: 'list', hosts: hostnameSet(option, 'hostname') }
}

interface ResolveEventHostnameArgs {
	option: ResolvedHostnameOption
	claimed: string | undefined
	req: PayloadRequest
	scope: string | null
	trustedProxyHops?: number
}

/**
 * Hostname to store for one event, or null to drop it. A throwing resolver drops the event too:
 * on a public path a broken lookup loses the event, not the response.
 */
export const resolveEventHostname = async ({
	option,
	claimed,
	req,
	scope,
	trustedProxyHops,
}: ResolveEventHostnameArgs): Promise<string | null> => {
	const host = requestHostname(req.headers, { trustedProxyHops })
	if (option.kind === 'request') {
		return host
	}
	if (option.kind === 'list') {
		return host && option.hosts.has(host) ? host : null
	}
	try {
		return normalizeHostname(await option.resolve({ claimed, req, scope }))
	} catch {
		return null
	}
}
