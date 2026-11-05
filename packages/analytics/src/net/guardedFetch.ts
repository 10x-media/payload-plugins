import { lookup as dnsLookup } from 'node:dns'
import type { LookupFunction } from 'node:net'
import ipaddr from 'ipaddr.js'
import { Agent, fetch as undiciFetch } from 'undici'
import type { FetchInit, FetchLike } from '../core/fetch'
import { monotonicMs } from '../core/monotonic'
import { HostRefusedError } from '../core/sourceErrors'

/** Redirects followed before a request gives up; every hop is checked like the first. */
export const MAX_REDIRECTS = 3

const REDIRECT_STATUSES: ReadonlySet<number> = new Set([301, 302, 303, 307, 308])

const NULL_BODY_STATUSES: ReadonlySet<number> = new Set([101, 103, 204, 205, 304])

/** What a hop to another origin keeps: none of these can carry a credential. */
const CROSS_ORIGIN_HEADERS: ReadonlySet<string> = new Set([
	'accept',
	'accept-language',
	'content-language',
	'content-type',
	'user-agent',
])

/**
 * Only a public unicast address is reachable. Loopback, private, link-local, carrier-grade NAT,
 * IPv4-mapped IPv6 and every other special range ipaddr.js knows are refused.
 */
export const isPublicAddress = (ip: string): boolean => {
	if (!ipaddr.isValid(ip)) {
		return false
	}
	try {
		return ipaddr.parse(ip).range() === 'unicast'
	} catch {
		return false
	}
}

const FAKE_IP_RANGE = ipaddr.IPv4.parseCIDR('198.18.0.0/15')

/**
 * Whether `ip` is in 198.18.0.0/15, the benchmarking range local proxies such as Clash or Surge
 * hand out in fake-IP mode, written as IPv4 or as IPv4-mapped IPv6.
 */
export const isFakeIpAddress = (ip: string): boolean => {
	if (!ipaddr.isValid(ip)) {
		return false
	}
	const parsed = ipaddr.process(ip)
	return parsed instanceof ipaddr.IPv4 && parsed.match(FAKE_IP_RANGE)
}

/** Told the name and every address of each lookup refused. */
type OnRefused = (hostname: string, addresses: readonly string[]) => void

/**
 * A lookup that hands on public addresses only. It runs for every new connection, so a name that
 * answers a public address first and a private one later is refused the second time.
 */
export const guardLookup =
	(lookup: LookupFunction, onRefused?: OnRefused): LookupFunction =>
	(hostname, options, callback) => {
		lookup(hostname, options, (err, address, family) => {
			if (err) {
				callback(err, address, family)
				return
			}
			const addresses = Array.isArray(address) ? address.map((entry) => entry.address) : [address]
			if (addresses.length === 0 || !addresses.every((ip) => isPublicAddress(ip))) {
				onRefused?.(hostname, addresses)
				callback(
					new HostRefusedError(hostname, 'it resolves to a private or reserved address'),
					address,
					family
				)
				return
			}
			callback(null, address, family)
		})
	}

/** One fake-IP hint at most this often: on such a machine every vendor is refused the same way. */
export const FAKE_IP_HINT_MS = 60_000

/**
 * Explains, at most once per {@link FAKE_IP_HINT_MS}, a refusal into 198.18.0.0/15: most likely a
 * local proxy's fake-IP mode, which only a development machine should let past.
 */
export const fakeIpHint = (warn: (message: string) => void, now: () => number): OnRefused => {
	let saidAt: number | null = null
	return (hostname, addresses) => {
		const fake = addresses.find(isFakeIpAddress)
		const at = now()
		if (fake === undefined || (saidAt !== null && at - saidAt < FAKE_IP_HINT_MS)) {
			return
		}
		saidAt = at
		warn(
			`analytics: ${hostname} is refused because it resolves to ${fake}, in 198.18.0.0/15, which looks like a local proxy's fake-IP mode (Clash, Surge). In development, set providers.hosts.allowPrivateNetwork to reach it through the proxy. Logged at most once a minute.`
		)
	}
}

/** One request of a chain, before redirects are followed. */
export interface Hop {
	url: URL
	method: string
	headers: Record<string, string>
	body: string | ArrayBuffer | null
}

/** Sends one hop as it stands, following nothing. */
export type SendHop = (hop: Hop, signal?: AbortSignal) => Promise<Response>

/** The host without an IPv6 literal's brackets, which `URL.hostname` keeps. */
const literalHost = (url: URL): string =>
	url.hostname.startsWith('[') && url.hostname.endsWith(']')
		? url.hostname.slice(1, -1)
		: url.hostname

/**
 * What every hop has to pass before it is sent: https, and a host that is not a private address
 * written out. A name is checked at connect time instead, by {@link guardLookup}.
 */
const assertReachable = (url: URL): void => {
	if (url.protocol !== 'https:') {
		throw new HostRefusedError(url.host, `${url.protocol} is not https`)
	}
	const host = literalHost(url)
	if (ipaddr.isValid(host) && !isPublicAddress(host)) {
		throw new HostRefusedError(url.host, 'it is a private or reserved address')
	}
}

const headerRecord = (init: HeadersInit | undefined): Record<string, string> => {
	const record: Record<string, string> = {}
	new Headers(init).forEach((value, name) => {
		record[name] = value
	})
	return record
}

const pickHeaders = (
	headers: Record<string, string>,
	keep: (name: string) => boolean
): Record<string, string> =>
	Object.fromEntries(Object.entries(headers).filter(([name]) => keep(name)))

/**
 * Next hop as fetch would send it: a 303, or a 301/302 answering a POST, becomes a bodiless GET; a
 * hop to another origin drops every header that could carry a credential.
 */
const nextHop = (hop: Hop, status: number, url: URL): Hop => {
	const headers =
		url.origin === hop.url.origin
			? hop.headers
			: pickHeaders(hop.headers, (name) => CROSS_ORIGIN_HEADERS.has(name))
	const toGet =
		status === 303
			? hop.method !== 'HEAD'
			: (status === 301 || status === 302) && hop.method === 'POST'
	if (!toGet) {
		return { url, method: hop.method, headers, body: hop.body }
	}
	return {
		url,
		method: 'GET',
		headers: pickHeaders(headers, (name) => !name.startsWith('content-')),
		body: null,
	}
}

/**
 * Follows at most {@link MAX_REDIRECTS} redirects itself so each hop passes the first's checks.
 * `redirect: 'manual'` hands a redirect back unfollowed, `'error'` refuses it.
 */
export const followRedirects = async (
	send: SendHop,
	input: string | URL,
	init: FetchInit = {}
): Promise<Response> => {
	const mode = init.redirect ?? 'follow'
	const signal = init.signal ?? undefined
	let hop: Hop = {
		url: new URL(input),
		method: (init.method ?? 'GET').toUpperCase(),
		headers: headerRecord(init.headers),
		body: init.body ?? null,
	}
	for (let redirects = 0; ; redirects++) {
		assertReachable(hop.url)
		const res = await send(hop, signal)
		const location = res.headers.get('location')
		if (mode === 'manual' || !REDIRECT_STATUSES.has(res.status) || location === null) {
			return res
		}
		await res.body?.cancel()
		if (mode === 'error') {
			throw new TypeError(`analytics: ${hop.url.host} answered a redirect`)
		}
		if (redirects >= MAX_REDIRECTS) {
			throw new HostRefusedError(hop.url.host, `it redirected more than ${MAX_REDIRECTS} times`)
		}
		hop = nextHop(hop, res.status, new URL(location, hop.url))
	}
}

/** How deep undici may wrap a lookup's refusal in `cause`s. */
const MAX_CAUSE_DEPTH = 5

/** The refusal behind an undici failure, so callers see the `HostRefusedError` itself. */
const refusalIn = (err: unknown): HostRefusedError | null => {
	let current: unknown = err
	for (let depth = 0; depth < MAX_CAUSE_DEPTH; depth++) {
		if (current instanceof HostRefusedError) {
			return current
		}
		if (typeof current !== 'object' || current === null) {
			return null
		}
		current = Reflect.get(current, 'cause')
	}
	return null
}

type UndiciResponse = Awaited<ReturnType<typeof undiciFetch>>

const standardBody = (res: UndiciResponse): ReadableStream<Uint8Array> | null => {
	const source = res.body
	if (source === null || NULL_BODY_STATUSES.has(res.status)) {
		return null
	}
	const reader = source.getReader()
	return new ReadableStream<Uint8Array>({
		pull: async (controller) => {
			const chunk = await reader.read()
			if (chunk.done) {
				controller.close()
				return
			}
			controller.enqueue(chunk.value)
		},
		cancel: (reason) => reader.cancel(reason),
	})
}

/** undici's answer as a standard `Response`, its body still streaming. */
export const toStandardResponse = (res: UndiciResponse): Response => {
	const headers = new Headers()
	res.headers.forEach((value, name) => {
		headers.append(name, value)
	})
	return new Response(standardBody(res), {
		status: res.status,
		statusText: res.statusText,
		headers,
	})
}

/** @beta */
export interface GuardedFetchOptions {
	/** Resolves a name for each new connection. Node's own `dns.lookup` unless a test swaps it. */
	lookup?: LookupFunction
	/** Reaches every address over http or https, private networks included, with no checks at all. */
	allowPrivateNetwork?: boolean
	/** Where the hint about a local proxy's fake-IP mode goes (see {@link fakeIpHint}). */
	warn?: (message: string) => void
	/** The clock that hint is limited by; `monotonicMs` unless a test swaps it. */
	now?: () => number
}

/** @beta */
export interface GuardedFetch {
	fetch: FetchLike
	/** Closes the connection pool once the requests in flight finish. */
	close: () => Promise<void>
}

/**
 * Fetch for adapters built from provider documents: refuses a host resolving to a non-public
 * address, on every connection and redirect hop, with a `HostRefusedError`.
 *
 * @beta
 */
export const createGuardedFetch = (options: GuardedFetchOptions = {}): GuardedFetch => {
	if (options.allowPrivateNetwork === true) {
		return { fetch: (input, init) => fetch(input, init), close: async () => undefined }
	}
	const onRefused = options.warn ? fakeIpHint(options.warn, options.now ?? monotonicMs) : undefined
	const agent = new Agent({
		connect: { lookup: guardLookup(options.lookup ?? dnsLookup, onRefused) },
	})
	const send: SendHop = async (hop, signal) => {
		try {
			const res = await undiciFetch(hop.url.href, {
				method: hop.method,
				headers: hop.headers,
				body: hop.body,
				redirect: 'manual',
				dispatcher: agent,
				...(signal ? { signal } : {}),
			})
			return toStandardResponse(res)
		} catch (err) {
			throw refusalIn(err) ?? err
		}
	}
	return {
		fetch: (input, init) => followRedirects(send, input, init),
		close: () => agent.close(),
	}
}
