import type { PayloadRequest } from 'payload'
import { isHostname, normalizeHostname, requestHostname } from './requestHost'

/**
 * Decides the hostname an event is stored under, or null to drop it. `claimed` is what the
 * body sent, which is never trusted on its own; `scope` is the scope the request already
 * resolved to, so a split deployment can validate `Origin` against that tenant's own domains.
 *
 * The answer must be a hostname: it is normalized and then held to the same shape a request
 * host is, and anything else (a slug, a tenant id, free text) drops the event rather than
 * storing per-event text no rollup family can ever be pruned from.
 *
 * Distinct from the binding `HostnameResolver`, which names the hostname a document is read
 * under rather than the one an event is written under.
 */
export type EventHostnameResolver = (args: {
	claimed: string | undefined
	req: PayloadRequest
	scope: string | null
}) => string | null | Promise<string | null>

/**
 * `'request'` stores the host the request carried. A list stores the request host only when it
 * is one of those, for a single-site install behind no host validation. A function decides for
 * itself.
 */
export type HostnameOption = 'request' | string[] | EventHostnameResolver

export type ResolvedHostnameOption =
	| { kind: 'request' }
	| { kind: 'list'; hosts: ReadonlySet<string> }
	| { kind: 'resolver'; resolve: EventHostnameResolver }

/**
 * Config-time list validation: entries are lowercased here, so the ingest compare is exact.
 * The port is not stripped the way a request host's is, because an entry carrying one would
 * otherwise be accepted and then silently never match what is stored.
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
