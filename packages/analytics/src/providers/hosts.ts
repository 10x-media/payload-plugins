import type { TextFieldSingleValidation } from 'payload'
import { isRecord, onlyKeys } from '../core/values'
import { type OriginProblem, parseHttpUrl, parseOrigin } from '../net/origin'
import { keys } from '../translations/keys'
import { asTranslate } from '../translations/server'

/** The providers whose document names a host. GA4 always talks to Google. */
export type HostedProvider = 'plausible' | 'umami' | 'posthog'

/**
 * Each vendor's own cloud, always allowed: its default origin, Umami Cloud's app address, and
 * PostHog's other region and legacy US address.
 */
export const CLOUD_ORIGINS: Readonly<Record<HostedProvider, readonly string[]>> = {
	plausible: ['https://plausible.io'],
	umami: ['https://api.umami.is', 'https://cloud.umami.is'],
	posthog: ['https://us.posthog.com', 'https://eu.posthog.com', 'https://app.posthog.com'],
}

/** One `providers.hosts.allow` entry, parsed. */
export type HostPattern =
	| { kind: 'exact'; origin: string }
	| { kind: 'subdomains'; protocol: string; port: string; suffix: string }

/** `providers.hosts`, resolved. */
export interface ProviderHostPolicy {
	allow: readonly HostPattern[]
	allowPrivateNetwork: boolean
}

export const DEFAULT_HOST_POLICY: ProviderHostPolicy = { allow: [], allowPrivateNetwork: false }

/** A vendor's address, as a document's `host` names it. */
interface HostAddress {
	/** Scheme, host and port: what the allowlist matches. */
	origin: string
	/** The origin and the base path a vendor served under a sub-path needs, with no trailing slash. */
	address: string
}

/**
 * The address `value` names: an origin and an optional base path, with no credentials, query or
 * fragment and its trailing slash dropped. `http` only when the install allows private networks.
 */
export const parseHostAddress = (
	value: string,
	allowPrivateNetwork: boolean
): HostAddress | { problem: OriginProblem } => {
	const url = parseHttpUrl(value, allowPrivateNetwork)
	if (!(url instanceof URL)) {
		return url
	}
	return { origin: url.origin, address: `${url.origin}${url.pathname.replace(/\/+$/, '')}` }
}

const WILDCARD = '*.'

/**
 * One allow entry: `https://analytics.example.com`, or `https://*.example.com` for every
 * subdomain of example.com (not example.com itself). Throws a boot error naming the entry.
 */
export const parseHostPattern = (entry: unknown, allowPrivateNetwork: boolean): HostPattern => {
	const fail = (reason: string): never => {
		throw new Error(`analytics: providers.hosts.allow entry ${JSON.stringify(entry)} ${reason}`)
	}
	if (typeof entry !== 'string' || entry.trim() === '') {
		return fail('must be an origin such as "https://analytics.example.com"')
	}
	const trimmed = entry.trim()
	const scheme = trimmed.indexOf('://')
	const wildcard = scheme !== -1 && trimmed.startsWith(WILDCARD, scheme + 3)
	const candidate = wildcard
		? `${trimmed.slice(0, scheme + 3)}${trimmed.slice(scheme + 3 + WILDCARD.length)}`
		: trimmed
	if (candidate.includes('*')) {
		return fail('may only start its host with "*.", as in "https://*.example.com"')
	}
	const parsed = parseOrigin(candidate, allowPrivateNetwork)
	if ('problem' in parsed) {
		return fail(
			parsed.problem === 'insecure'
				? 'uses http, which needs providers.hosts.allowPrivateNetwork'
				: 'must be an origin with no path, query or credentials, such as "https://analytics.example.com"'
		)
	}
	if (!wildcard) {
		return { kind: 'exact', origin: parsed.origin }
	}
	const url = new URL(parsed.origin)
	if (!url.hostname.includes('.')) {
		return fail(
			'would match every site under one top-level domain; name a domain, as in "https://*.example.com"'
		)
	}
	return { kind: 'subdomains', protocol: url.protocol, port: url.port, suffix: url.hostname }
}

/**
 * `providers.hosts` checked at boot.
 *
 * @beta
 */
export const resolveHostPolicy = (option: unknown): ProviderHostPolicy => {
	if (option === undefined) {
		return DEFAULT_HOST_POLICY
	}
	if (!isRecord(option) || Array.isArray(option)) {
		throw new Error(
			'analytics: providers.hosts must be an object such as { allow: ["https://analytics.example.com"] }'
		)
	}
	onlyKeys(option, ['allow', 'allowPrivateNetwork'], 'providers.hosts')
	const allowPrivateNetwork = option.allowPrivateNetwork ?? false
	if (typeof allowPrivateNetwork !== 'boolean') {
		throw new Error('analytics: providers.hosts.allowPrivateNetwork must be a boolean')
	}
	const allow = option.allow ?? []
	if (!Array.isArray(allow)) {
		throw new Error('analytics: providers.hosts.allow must be a list of origins')
	}
	return {
		allow: allow.map((entry: unknown) => parseHostPattern(entry, allowPrivateNetwork)),
		allowPrivateNetwork,
	}
}

const matches = (pattern: HostPattern, url: URL): boolean =>
	pattern.kind === 'exact'
		? url.origin === pattern.origin
		: url.protocol === pattern.protocol &&
			url.port === pattern.port &&
			url.hostname.endsWith(`.${pattern.suffix}`)

/** Whether a document's host may be reached, and the address it names; null for the vendor's cloud. */
export type DocumentHost =
	| { ok: true; address: string | null }
	| { ok: false; host: string; reason: string }

/**
 * A document's `host` under the install's policy: blank is the vendor's cloud, anything else needs
 * an origin that is that cloud or in `allow`. The allowlist is about which server, not which path.
 */
export const checkDocumentHost = (
	provider: HostedProvider,
	raw: string | null | undefined,
	policy: ProviderHostPolicy
): DocumentHost => {
	const value = raw?.trim() ?? ''
	if (value === '') {
		return { ok: true, address: null }
	}
	const parsed = parseHostAddress(value, policy.allowPrivateNetwork)
	if ('problem' in parsed) {
		return {
			ok: false,
			host: value,
			reason:
				parsed.problem === 'insecure'
					? 'it uses http, which needs providers.hosts.allowPrivateNetwork'
					: 'it is not an address this install accepts',
		}
	}
	if (CLOUD_ORIGINS[provider].includes(parsed.origin)) {
		return { ok: true, address: parsed.address }
	}
	const url = new URL(parsed.origin)
	if (policy.allow.some((pattern) => matches(pattern, url))) {
		return { ok: true, address: parsed.address }
	}
	return { ok: false, host: parsed.origin, reason: 'it is not listed in providers.hosts.allow' }
}

/**
 * The `validate` of every provider `host` field: blank, or the address of the service with an
 * optional base path and nothing else, over https unless the install allows private networks.
 */
export const validateProviderHost =
	(allowPrivateNetwork: boolean): TextFieldSingleValidation =>
	(value, { req }) => {
		if (!value || value.trim() === '') {
			return true
		}
		const parsed = parseHostAddress(value, allowPrivateNetwork)
		if (!('problem' in parsed)) {
			return true
		}
		return asTranslate(req.t)(
			parsed.problem === 'insecure' ? keys.providerErrorHostInsecure : keys.providerErrorHostFormat
		)
	}
