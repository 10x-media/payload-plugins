import type { PayloadRequest } from 'payload'
import { MAX_HOSTNAME_LENGTH, normalizeHostname, requestHostname } from './requestHost'

/**
 * Decides the hostname an event is stored under, or null to drop it. `claimed` is what the
 * body sent, which is never trusted on its own; `scope` is the scope the request already
 * resolved to, so a split deployment can validate `Origin` against that tenant's own domains.
 */
export type HostnameResolver = (args: {
	claimed: string | undefined
	req: PayloadRequest
	scope: string | null
}) => string | null | Promise<string | null>

/**
 * `'request'` stores the host the request carried. A list stores the request host only when it
 * is one of those, for a single-site install behind no host validation. A function decides for
 * itself.
 */
export type HostnameOption = 'request' | string[] | HostnameResolver

export type ResolvedHostnameOption =
	| { kind: 'request' }
	| { kind: 'list'; hosts: ReadonlySet<string> }
	| { kind: 'resolver'; resolve: HostnameResolver }

/**
 * Dot-separated labels and nothing else. Stricter than what a request host is normalized to,
 * because a configured entry carrying a scheme or a port would silently never match.
 */
const HOSTNAME = /^[a-z0-9_-]+(\.[a-z0-9_-]+)*$/

/** Config-time list validation: entries are lowercased here, so the ingest compare is exact. */
export const hostnameSet = (values: string[] | undefined, option: string): ReadonlySet<string> => {
	const hosts = new Set<string>()
	for (const value of values ?? []) {
		const host = typeof value === 'string' ? value.trim().toLowerCase().replace(/\.$/, '') : ''
		if (!host || host.length > MAX_HOSTNAME_LENGTH || !HOSTNAME.test(host)) {
			throw new Error(
				`analytics: ${option} entries must each be a bare hostname, got "${String(value)}"`
			)
		}
		hosts.add(host)
	}
	return hosts
}

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

export interface ResolveEventHostnameArgs {
	option: ResolvedHostnameOption
	claimed: string | undefined
	req: PayloadRequest
	scope: string | null
	trustedProxyHops?: number
}

/**
 * The hostname to store for one event, or null to drop it. A resolver that throws drops the
 * event too: ingest is a public path, so a broken lookup loses the event rather than the
 * response.
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
