import { lookup as dnsLookup } from 'node:dns'
import type { LookupFunction } from 'node:net'
import ipaddr from 'ipaddr.js'
import { Agent, fetch as undiciFetch } from 'undici'

import { isAllowedHost } from './allowedHosts'

/** What a subscription URL is held to. Built once from `delivery` and handed to every send path. */
export type UrlPolicy = {
	allowedHosts?: string[]
	allowHttp: boolean
	allowPrivateAddresses: boolean
}

export type UrlRefusal = 'host' | 'insecure' | 'invalid' | 'private'

/** What a refused delivery records. Names the option that would allow it, never the URL's path. */
export const REFUSAL_REASON: Record<UrlRefusal, string> = {
	invalid: 'the endpoint is not an absolute http(s) URL, so the delivery was refused',
	host: 'the endpoint host is not in delivery.allowedHosts, so the delivery was refused',
	insecure: 'the endpoint is not https and delivery.allowHttp is off, so the delivery was refused',
	private:
		'the endpoint is a loopback, private or otherwise non-public address and delivery.allowPrivateAddresses is off, so the delivery was refused',
}

const BLOCKED_AT_SOCKET =
	'the endpoint resolves to a loopback, private or otherwise non-public address, so the delivery was refused'

/**
 * The network calls, behind one object so a test can replace them. Payload's own `safeFetch`
 * exposes its lookup the same way.
 */
export const transport = { fetch: undiciFetch, lookup: dnsLookup }

/** Thrown from the socket's DNS lookup, so it arrives as the `cause` of the failed fetch. */
export class BlockedDestinationError extends Error {}

/**
 * Ranges ipaddr.js files under plain `unicast` that still lead inward: IPv4-compatible IPv6
 * (`::a.b.c.d`, deprecated, and another spelling of an IPv4 address), the local-use NAT64 prefix
 * of RFC 8215, and deprecated site-local addresses, which networks that still carry them use the
 * way they use RFC 1918.
 */
const INWARD_RANGES = ['::/96', '64:ff9b:1::/48', 'fec0::/10'].map((cidr) => ipaddr.parseCIDR(cidr))

/**
 * Whether an address is one a public receiver can have. Classification is ipaddr.js's: anything
 * outside its `unicast` range is refused, which covers loopback, RFC 1918, link-local (the cloud
 * metadata address), carrier-grade NAT, unique-local, multicast, and the translation prefixes
 * (NAT64, 6to4, Teredo) that reach an IPv4 address through an IPv6 one. `process` unwraps an
 * IPv4-mapped IPv6 address first. Unparseable input is refused.
 */
export const isPublicAddress = (address: string): boolean => {
	if (!ipaddr.isValid(address)) {
		return false
	}
	const parsed = ipaddr.process(address)
	return (
		parsed.range() === 'unicast' &&
		!INWARD_RANGES.some(
			([range, bits]) => parsed.kind() === range.kind() && parsed.match(range, bits)
		)
	)
}

/** A URL's host without the brackets the URL parser keeps around an IPv6 literal. */
export const hostOf = (url: string): string => new URL(url).hostname.replace(/^\[|\]$/g, '')

/**
 * Why a URL may not be delivered to, or null when it may.
 *
 * It judges what the URL says. The URL parser has already folded every alternative spelling of an
 * IPv4 address (decimal, hex, octal, short forms) into dotted form, so one literal check covers
 * them. What a hostname resolves to is judged where the socket opens, by the guarded dispatcher.
 *
 * A code subscription is held to the allowlist only: its URL lives in the repository, which is as
 * trusted as the plugin, and an internal receiver is a normal thing for one to point at.
 */
export const urlRefusal = (
	value: string,
	policy: UrlPolicy,
	source: 'code' | 'collection'
): UrlRefusal | null => {
	const url = URL.canParse(value) ? new URL(value) : null
	if (
		!url ||
		(url.protocol !== 'http:' && url.protocol !== 'https:') ||
		url.username !== '' ||
		url.password !== ''
	) {
		return 'invalid'
	}
	if (!isAllowedHost(value, policy.allowedHosts)) {
		return 'host'
	}
	if (source === 'code') {
		return null
	}
	if (url.protocol === 'http:' && !policy.allowHttp) {
		return 'insecure'
	}
	const host = hostOf(value)
	if (!policy.allowPrivateAddresses && ipaddr.isValid(host) && !isPublicAddress(host)) {
		return 'private'
	}
	return null
}

/**
 * The DNS lookup the guarded dispatcher connects through. Every address in the answer has to be
 * public, so a name that returns one public and one private record is refused too. Because this
 * is the lookup the socket itself uses, the address that was checked is the address that is
 * connected to: there is no second resolution for a rebinding name to answer differently.
 */
const guardedLookup: LookupFunction = (hostname, options, callback) => {
	transport.lookup(hostname, options, (err, address, family) => {
		if (err) {
			callback(err, address, family)
			return
		}
		const addresses = Array.isArray(address) ? address.map((a) => a.address) : [address]
		if (addresses.some((a) => !isPublicAddress(a))) {
			callback(new BlockedDestinationError(BLOCKED_AT_SOCKET), address, family)
			return
		}
		callback(null, address, family)
	})
}

let agent: Agent | undefined

/** The dispatcher for deliveries that must not reach a non-public address. One pool, made on first use. */
export const guardedDispatcher = (): Agent => {
	agent ??= new Agent({ connect: { lookup: guardedLookup } })
	return agent
}

/**
 * Whether a hostname currently resolves to an address deliveries are not sent to. For the save
 * form only: it gives the operator the reason now instead of in a dead delivery row. A name that
 * does not resolve is not judged here, since the receiver may not be deployed yet; the send is
 * what enforces.
 */
export const resolvesToBlocked = (hostname: string): Promise<boolean> =>
	new Promise((resolve) => {
		transport.lookup(hostname, { all: true }, (err, addresses) => {
			resolve(!err && addresses.some((a) => !isPublicAddress(a.address)))
		})
	})
