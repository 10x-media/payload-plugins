import type { PayloadRequest } from 'payload'
import { describe, expect, it, vi } from 'vitest'
import type { HostnameResolver } from './resolveHostname'
import {
	hostnameSet,
	type ResolvedHostnameOption,
	resolveEventHostname,
	resolveHostnameOption,
} from './resolveHostname'

const req = (headers: Record<string, string>): PayloadRequest =>
	({ headers: new Headers(headers) }) as unknown as PayloadRequest

const resolve = (
	option: ResolvedHostnameOption,
	headers: Record<string, string>,
	extra: { claimed?: string; scope?: string | null; trustedProxyHops?: number } = {}
) =>
	resolveEventHostname({
		option,
		claimed: extra.claimed,
		req: req(headers),
		scope: extra.scope ?? null,
		trustedProxyHops: extra.trustedProxyHops,
	})

describe('resolveHostnameOption', () => {
	it('defaults to the request', () => {
		expect(resolveHostnameOption(undefined)).toEqual({ kind: 'request' })
		expect(resolveHostnameOption('request')).toEqual({ kind: 'request' })
	})

	it('lowercases a list on the way in', () => {
		const option = resolveHostnameOption(['A.Example', 'b.example.'])
		expect(option.kind).toBe('list')
		expect(option.kind === 'list' && [...option.hosts]).toEqual(['a.example', 'b.example'])
	})

	it('throws on a list entry that is not a usable hostname', () => {
		for (const entry of ['', '   ', 'a example', 'https://a.example']) {
			expect(() => resolveHostnameOption([entry])).toThrow(/hostname/i)
		}
	})

	it('throws on an empty list, which would drop every event', () => {
		expect(() => resolveHostnameOption([])).toThrow(/at least one hostname/i)
	})

	it('keeps a resolver function', () => {
		const fn = async () => 'a.example'
		expect(resolveHostnameOption(fn)).toEqual({ kind: 'resolver', resolve: fn })
	})
})

describe('hostnameSet', () => {
	it('lowercases entries and answers an empty set for an absent option', () => {
		expect([...hostnameSet(['Platform.Example'], 'platformHostnames')]).toEqual([
			'platform.example',
		])
		expect(hostnameSet(undefined, 'platformHostnames').size).toBe(0)
	})

	it('throws on an unusable entry, naming the option', () => {
		expect(() => hostnameSet(['a/b'], 'platformHostnames')).toThrow(/platformHostnames/)
	})
})

describe('resolveEventHostname', () => {
	const request: ResolvedHostnameOption = { kind: 'request' }

	it('answers the request host and ignores the body claim', async () => {
		expect(await resolve(request, { host: 'a.example' }, { claimed: 'evil.example' })).toBe(
			'a.example'
		)
	})

	it('ignores Origin', async () => {
		expect(await resolve(request, { host: 'a.example', origin: 'https://evil.example' })).toBe(
			'a.example'
		)
	})

	it('answers null when the request carries no usable host', async () => {
		expect(await resolve(request, {}, { claimed: 'evil.example' })).toBeNull()
	})

	it('reads the forwarded host only at a trusted hop', async () => {
		const headers = { host: 'a.example', 'x-forwarded-host': 'b.example' }
		expect(await resolve(request, headers)).toBe('a.example')
		expect(await resolve(request, headers, { trustedProxyHops: 1 })).toBe('b.example')
	})

	it('answers a listed request host and drops an unlisted one', async () => {
		const option = resolveHostnameOption(['a.example'])
		expect(await resolve(option, { host: 'A.Example:3000' })).toBe('a.example')
		expect(await resolve(option, { host: 'b.example' }, { claimed: 'a.example' })).toBeNull()
		expect(await resolve(option, {})).toBeNull()
	})

	it('hands a resolver the claim, the request and the scope', async () => {
		const fn = vi.fn<HostnameResolver>(async () => 'Chosen.Example')
		const option = resolveHostnameOption(fn)
		expect(
			await resolve(option, { host: 'a.example' }, { claimed: 'claimed.example', scope: 't1' })
		).toBe('chosen.example')
		expect(fn.mock.calls[0]?.[0]?.claimed).toBe('claimed.example')
		expect(fn.mock.calls[0]?.[0]?.scope).toBe('t1')
	})

	it('caps a resolver answer and drops an unusable or null one', async () => {
		const long = `${'a'.repeat(300)}.example`
		expect(
			await resolve(
				resolveHostnameOption(() => long),
				{ host: 'a.example' }
			)
		).toHaveLength(253)
		expect(
			await resolve(
				resolveHostnameOption(() => null),
				{ host: 'a.example' }
			)
		).toBeNull()
		expect(
			await resolve(
				resolveHostnameOption(() => '  '),
				{ host: 'a.example' }
			)
		).toBeNull()
	})

	it('drops the event when a resolver throws', async () => {
		const option = resolveHostnameOption(() => {
			throw new Error('lookup failed')
		})
		expect(await resolve(option, { host: 'a.example' })).toBeNull()
	})
})
