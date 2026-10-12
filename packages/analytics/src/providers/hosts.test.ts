import { describe, expect, it } from 'vitest'
import {
	CLOUD_ORIGINS,
	checkDocumentHost,
	DEFAULT_HOST_POLICY,
	type HostedProvider,
	parseHostAddress,
	parseHostPattern,
	resolveHostPolicy,
	validateProviderHost,
} from './hosts'

const t = { req: { t: (key: string) => key } } as never

describe('validateProviderHost', () => {
	const https = validateProviderHost(false)
	const http = validateProviderHost(true)

	it.each([
		['blank', '', true],
		['an https origin', 'https://analytics.example.com', true],
		['an https origin with a trailing slash', 'https://analytics.example.com/', true],
		['an https origin with a port', 'https://analytics.example.com:8443', true],
		['an origin with spaces around it', '  https://analytics.example.com  ', true],
		['plain http', 'http://analytics.example.com', 'analytics:providerErrorHostInsecure'],
		['a base path', 'https://example.com/umami', true],
		['a base path with a trailing slash', 'https://example.com/umami/', true],
		['a query', 'https://analytics.example.com/?a=1', 'analytics:providerErrorHostFormat'],
		['a fragment', 'https://analytics.example.com/#x', 'analytics:providerErrorHostFormat'],
		['credentials', 'https://user:pass@analytics.example.com', 'analytics:providerErrorHostFormat'],
		['a bare name', 'analytics.example.com', 'analytics:providerErrorHostFormat'],
		['another scheme', 'ftp://analytics.example.com', 'analytics:providerErrorHostFormat'],
		['javascript', 'javascript:alert(1)', 'analytics:providerErrorHostFormat'],
		['a file URL', 'file:///etc/passwd', 'analytics:providerErrorHostFormat'],
	])('answers %s', (_label, value, expected) => {
		expect(https(value, t)).toBe(expected)
	})

	it('accepts http once private networks are allowed, and nothing more', () => {
		expect(http('http://umami:3000', t)).toBe(true)
		expect(http('http://umami:3000/umami', t)).toBe(true)
		expect(http('http://umami:3000/?a=1', t)).toBe('analytics:providerErrorHostFormat')
		expect(http('ftp://umami', t)).toBe('analytics:providerErrorHostFormat')
	})
})

describe('parseHostAddress', () => {
	it('keeps a base path, drops its trailing slash, and names the origin it is on', () => {
		expect(parseHostAddress(' HTTPS://Example.COM:443/Umami/ ', false)).toEqual({
			origin: 'https://example.com',
			address: 'https://example.com/Umami',
		})
		expect(parseHostAddress('https://example.com/', false)).toEqual({
			origin: 'https://example.com',
			address: 'https://example.com',
		})
	})

	it('refuses credentials, a query and a fragment, and plain http unless allowed', () => {
		for (const value of [
			'https://u:p@example.com/a',
			'https://example.com/a?b=1',
			'https://example.com/a#b',
		]) {
			expect(parseHostAddress(value, true), value).toEqual({ problem: 'format' })
		}
		expect(parseHostAddress('http://example.com/a', false)).toEqual({ problem: 'insecure' })
	})
})

describe('parseHostPattern', () => {
	it('reads an exact origin', () => {
		expect(parseHostPattern('https://analytics.example.com', false)).toEqual({
			kind: 'exact',
			origin: 'https://analytics.example.com',
		})
	})

	it('reads a leading wildcard as every subdomain', () => {
		expect(parseHostPattern('https://*.example.com', false)).toEqual({
			kind: 'subdomains',
			protocol: 'https:',
			port: '',
			suffix: 'example.com',
		})
		expect(parseHostPattern('http://*.svc.local:8080', true)).toEqual({
			kind: 'subdomains',
			protocol: 'http:',
			port: '8080',
			suffix: 'svc.local',
		})
	})

	it.each([
		['a path', 'https://analytics.example.com/api', /no path/],
		['plain http', 'http://analytics.example.com', /providers\.hosts\.allowPrivateNetwork/],
		['a wildcard elsewhere', 'https://a.*.example.com', /may only start/],
		['two wildcards', 'https://*.*.example.com', /may only start/],
		['a wildcard over a top-level domain', 'https://*.com', /top-level domain/],
		['a bare name', 'analytics.example.com', /no path/],
		['an empty string', '', /must be an origin/],
		['a number', 42, /must be an origin/],
	])('refuses %s at boot', (_label, entry, message) => {
		expect(() => parseHostPattern(entry, false)).toThrow(message)
	})
})

describe('resolveHostPolicy', () => {
	it('defaults to the vendor clouds alone', () => {
		expect(resolveHostPolicy(undefined)).toEqual(DEFAULT_HOST_POLICY)
		expect(DEFAULT_HOST_POLICY).toEqual({ allow: [], allowPrivateNetwork: false })
	})

	it('reads http entries only with allowPrivateNetwork', () => {
		expect(() => resolveHostPolicy({ allow: ['http://umami:3000'] })).toThrow(/allowPrivateNetwork/)
		expect(resolveHostPolicy({ allow: ['http://umami:3000'], allowPrivateNetwork: true })).toEqual({
			allow: [{ kind: 'exact', origin: 'http://umami:3000' }],
			allowPrivateNetwork: true,
		})
	})

	it.each([
		['a string', 'https://analytics.example.com', /must be an object/],
		['a non-list allow', { allow: 'https://analytics.example.com' }, /must be a list/],
		['a non-boolean switch', { allowPrivateNetwork: 'yes' }, /must be a boolean/],
	])('refuses %s', (_label, option, message) => {
		expect(() => resolveHostPolicy(option)).toThrow(message)
	})
})

describe('checkDocumentHost', () => {
	const policy = resolveHostPolicy({
		allow: ['https://analytics.example.com', 'https://*.tenants.example.net'],
	})

	it.each<[HostedProvider, string | null | undefined, boolean]>([
		['plausible', undefined, true],
		['plausible', '', true],
		['plausible', 'https://plausible.io', true],
		['umami', 'https://api.umami.is', true],
		['umami', 'https://cloud.umami.is', true],
		['posthog', 'https://us.posthog.com', true],
		['posthog', 'https://eu.posthog.com', true],
		['posthog', 'https://app.posthog.com', true],
		['posthog', 'https://plausible.io', false],
		['plausible', 'https://analytics.example.com', true],
		['umami', 'https://analytics.example.com/', true],
		['posthog', 'https://acme.tenants.example.net', true],
		['posthog', 'https://deep.acme.tenants.example.net', true],
		['posthog', 'https://tenants.example.net', false],
		['plausible', 'https://evilanalytics.example.com', false],
		['plausible', 'https://analytics.example.com.evil.test', false],
		['plausible', 'https://analytics.example.com:8443', false],
		['plausible', 'http://analytics.example.com', false],
		['plausible', 'https://analytics.example.com/plausible', true],
		['plausible', 'https://evil.example.org/analytics.example.com', false],
		['plausible', 'https://analytics.example.com/?next=1', false],
		['umami', 'https://169.254.169.254', false],
	])('%s at %s is allowed: %s', (provider, host, allowed) => {
		expect(checkDocumentHost(provider, host, policy).ok).toBe(allowed)
	})

	it('names the cloud as no address at all, and an allowed host as its address, base path kept', () => {
		expect(checkDocumentHost('plausible', null, policy)).toEqual({ ok: true, address: null })
		expect(checkDocumentHost('plausible', ' https://analytics.example.com/ ', policy)).toEqual({
			ok: true,
			address: 'https://analytics.example.com',
		})
		expect(checkDocumentHost('umami', 'https://analytics.example.com/umami/', policy)).toEqual({
			ok: true,
			address: 'https://analytics.example.com/umami',
		})
	})

	it("lists PostHog's older US address among its clouds", () => {
		expect(CLOUD_ORIGINS.posthog).toContain('https://app.posthog.com')
	})

	it('says why a host is refused, naming the option that would allow it', () => {
		expect(checkDocumentHost('plausible', 'https://evil.example.org', policy)).toEqual({
			ok: false,
			host: 'https://evil.example.org',
			reason: 'it is not listed in providers.hosts.allow',
		})
		expect(checkDocumentHost('umami', 'http://umami:3000', policy)).toEqual({
			ok: false,
			host: 'http://umami:3000',
			reason: 'it uses http, which needs providers.hosts.allowPrivateNetwork',
		})
		expect(checkDocumentHost('umami', 'umami:3000?x', policy)).toEqual({
			ok: false,
			host: 'umami:3000?x',
			reason: 'it is not an address this install accepts',
		})
	})
})
