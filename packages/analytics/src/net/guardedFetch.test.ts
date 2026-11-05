import type { LookupFunction } from 'node:net'
import { Response as UndiciResponse } from 'undici'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { HostRefusedError, isSourceMisconfigured } from '../core/sourceErrors'
import {
	createGuardedFetch,
	FAKE_IP_HINT_MS,
	fakeIpHint,
	followRedirects,
	guardLookup,
	type Hop,
	isFakeIpAddress,
	isPublicAddress,
	MAX_REDIRECTS,
	type SendHop,
	toStandardResponse,
} from './guardedFetch'

const PUBLIC_V4 = '93.184.215.14'
const PUBLIC_V6 = '2606:4700:4700::1111'

/** A lookup that answers each call with the next list of addresses, the last one repeating. */
const lookupAnswering = (...answers: string[][]): { lookup: LookupFunction; asked: string[] } => {
	const asked: string[] = []
	const lookup: LookupFunction = (hostname, options, callback) => {
		const addresses = answers[Math.min(asked.length, answers.length - 1)] ?? []
		asked.push(hostname)
		const family = (address: string) => (address.includes(':') ? 6 : 4)
		if (options.all) {
			callback(
				null,
				addresses.map((address) => ({ address, family: family(address) }))
			)
			return
		}
		const first = addresses[0] ?? ''
		callback(null, first, family(first))
	}
	return { lookup, asked }
}

const resolveWith = (
	lookup: LookupFunction,
	hostname: string,
	all: boolean
): Promise<{ err: Error | null; address: unknown }> =>
	new Promise((resolve) => {
		lookup(hostname, { all }, (err, address) => resolve({ err, address }))
	})

describe('isPublicAddress', () => {
	it.each([
		['public IPv4', PUBLIC_V4, true],
		['public IPv6', PUBLIC_V6, true],
		['private 10/8', '10.0.0.1', false],
		['private 172.16/12', '172.16.4.2', false],
		['private 192.168/16', '192.168.1.1', false],
		['loopback', '127.0.0.1', false],
		['IPv6 loopback', '::1', false],
		['link-local', '169.254.169.254', false],
		['IPv6 link-local', 'fe80::1', false],
		['v4-mapped loopback', '::ffff:127.0.0.1', false],
		['v4-mapped private', '::ffff:10.0.0.1', false],
		['v4-mapped public', `::ffff:${PUBLIC_V4}`, false],
		['carrier-grade NAT', '100.64.0.1', false],
		['unique local', 'fd12:3456::1', false],
		['unspecified', '0.0.0.0', false],
		['multicast', '224.0.0.1', false],
		['broadcast', '255.255.255.255', false],
		['not an address', 'example.com', false],
		['empty', '', false],
	])('%s %s is public: %s', (_label, ip, expected) => {
		expect(isPublicAddress(ip)).toBe(expected)
	})
})

describe('guardLookup', () => {
	it.each([
		['private', '10.0.0.1'],
		['loopback', '127.0.0.1'],
		['IPv6 loopback', '::1'],
		['link-local', '169.254.169.254'],
		['IPv6 link-local', 'fe80::1'],
		['v4-mapped IPv6', '::ffff:127.0.0.1'],
		['carrier-grade NAT', '100.64.0.1'],
		['unique local', 'fd00::1'],
	])('refuses a name that resolves to a %s address', async (_label, address) => {
		for (const all of [true, false]) {
			const { lookup } = lookupAnswering([address])
			const { err } = await resolveWith(guardLookup(lookup), 'tenant-host.test', all)
			expect(err).toBeInstanceOf(HostRefusedError)
			expect(isSourceMisconfigured(err)).toBe(true)
		}
	})

	it('refuses a name when any one of its addresses is private', async () => {
		const { lookup } = lookupAnswering([PUBLIC_V4, '10.0.0.1'])
		const { err } = await resolveWith(guardLookup(lookup), 'mixed.test', true)
		expect(err).toBeInstanceOf(HostRefusedError)
	})

	it('hands public addresses on untouched', async () => {
		const { lookup } = lookupAnswering([PUBLIC_V4, PUBLIC_V6])
		const { err, address } = await resolveWith(guardLookup(lookup), 'vendor.test', true)
		expect(err).toBeNull()
		expect(address).toEqual([
			{ address: PUBLIC_V4, family: 4 },
			{ address: PUBLIC_V6, family: 6 },
		])
	})

	it('refuses a rebinding name that answers public first and private after', async () => {
		const { lookup, asked } = lookupAnswering([PUBLIC_V4], ['10.0.0.1'])
		const guarded = guardLookup(lookup)
		expect((await resolveWith(guarded, 'rebind.test', true)).err).toBeNull()
		expect((await resolveWith(guarded, 'rebind.test', true)).err).toBeInstanceOf(HostRefusedError)
		expect(asked).toEqual(['rebind.test', 'rebind.test'])
	})

	it('tells what it refused, and nothing of a name it hands on', async () => {
		const refused: Array<[string, readonly string[]]> = []
		const onRefused = (hostname: string, addresses: readonly string[]) => {
			refused.push([hostname, addresses])
		}
		const mixed = lookupAnswering([PUBLIC_V4, '198.18.0.72'])
		await resolveWith(guardLookup(mixed.lookup, onRefused), 'plausible.io', true)
		const plain = lookupAnswering([PUBLIC_V4])
		await resolveWith(guardLookup(plain.lookup, onRefused), 'vendor.test', true)
		expect(refused).toEqual([['plausible.io', [PUBLIC_V4, '198.18.0.72']]])
	})

	it('passes a resolution failure through as it is', async () => {
		const failure = Object.assign(new Error('getaddrinfo ENOTFOUND gone.test'), {
			code: 'ENOTFOUND',
		})
		const lookup: LookupFunction = (_hostname, _options, callback) => callback(failure, '', 4)
		const { err } = await resolveWith(guardLookup(lookup), 'gone.test', false)
		expect(err).toBe(failure)
	})
})

describe('isFakeIpAddress', () => {
	it.each([
		['the start of 198.18.0.0/15', '198.18.0.0', true],
		['an address a proxy handed out', '198.18.0.72', true],
		['the end of 198.18.0.0/15', '198.19.255.255', true],
		['one written as IPv4-mapped IPv6', '::ffff:198.18.0.72', true],
		['the address just past the range', '198.20.0.1', false],
		['the address just before it', '198.17.255.255', false],
		['a private address', '10.0.0.1', false],
		['a public address', PUBLIC_V4, false],
		['IPv6 benchmarking', '2001:2::1', false],
		['not an address', 'plausible.io', false],
	])('%s (%s): %s', (_label, ip, expected) => {
		expect(isFakeIpAddress(ip)).toBe(expected)
	})
})

describe('fakeIpHint', () => {
	it('says a fake-IP refusal at most once a minute, and nothing of any other', () => {
		const said: string[] = []
		let at = 0
		const hint = fakeIpHint(
			(message) => said.push(message),
			() => at
		)
		hint('internal.test', ['10.0.0.1'])
		expect(said).toEqual([])
		hint('plausible.io', ['198.18.0.72'])
		expect(said).toHaveLength(1)
		expect(said[0]).toContain('plausible.io is refused because it resolves to 198.18.0.72')
		expect(said[0]).toContain("local proxy's fake-IP mode")
		expect(said[0]).toContain('providers.hosts.allowPrivateNetwork')
		at = FAKE_IP_HINT_MS - 1
		hint('us.posthog.com', ['198.18.0.90'])
		expect(said).toHaveLength(1)
		at = FAKE_IP_HINT_MS
		hint('us.posthog.com', ['198.18.0.90'])
		expect(said).toHaveLength(2)
		expect(said[1]).toContain('us.posthog.com is refused because it resolves to 198.18.0.90')
	})
})

describe('createGuardedFetch', () => {
	afterEach(() => {
		vi.restoreAllMocks()
	})

	it('still refuses a host a local proxy answers with a fake IP, and says why on the server', async () => {
		const { lookup } = lookupAnswering(['198.18.0.72'])
		const warned: string[] = []
		const guarded = createGuardedFetch({ lookup, warn: (message) => warned.push(message) })
		try {
			const refused = guarded.fetch('https://plausible.io/api/v2/query')
			await expect(refused).rejects.toBeInstanceOf(HostRefusedError)
			await expect(refused).rejects.toThrow(
				'plausible.io is refused: it resolves to a private or reserved address'
			)
			await expect(guarded.fetch('https://plausible.io/api/v2/query')).rejects.toBeInstanceOf(
				HostRefusedError
			)
			expect(warned).toHaveLength(1)
			expect(warned[0]).toContain('providers.hosts.allowPrivateNetwork')
		} finally {
			await guarded.close()
		}
	})

	it.each([
		['private', '10.0.0.7'],
		['loopback', '127.0.0.1'],
		['link-local', '169.254.169.254'],
		['v4-mapped IPv6', '::ffff:10.0.0.7'],
		['carrier-grade NAT', '100.64.12.1'],
	])('refuses at connect a host that resolves to a %s address', async (_label, address) => {
		const { lookup, asked } = lookupAnswering([address])
		const guarded = createGuardedFetch({ lookup })
		try {
			const refused = guarded.fetch('https://tenant-host.test/api/v2/query')
			await expect(refused).rejects.toBeInstanceOf(HostRefusedError)
			await expect(refused).rejects.toSatisfy(isSourceMisconfigured)
			expect(asked).toEqual(['tenant-host.test'])
		} finally {
			await guarded.close()
		}
	})

	it.each([
		'https://127.0.0.1/',
		'https://[::1]/',
		'https://[::ffff:7f00:1]/',
		'https://169.254.169.254/latest/meta-data',
		'https://100.64.0.1/',
		'https://2130706433/',
	])('refuses %s before any lookup', async (url) => {
		const { lookup, asked } = lookupAnswering([PUBLIC_V4])
		const guarded = createGuardedFetch({ lookup })
		try {
			await expect(guarded.fetch(url)).rejects.toBeInstanceOf(HostRefusedError)
			expect(asked).toEqual([])
		} finally {
			await guarded.close()
		}
	})

	it('refuses anything but https', async () => {
		const { lookup, asked } = lookupAnswering([PUBLIC_V4])
		const guarded = createGuardedFetch({ lookup })
		try {
			await expect(guarded.fetch('http://vendor.test/')).rejects.toBeInstanceOf(HostRefusedError)
			expect(asked).toEqual([])
		} finally {
			await guarded.close()
		}
	})

	it('is a plain fetch once private networks are allowed', async () => {
		const plain = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('ok'))
		const open = createGuardedFetch({ allowPrivateNetwork: true })
		const res = await open.fetch('http://umami:3000/api/websites', { method: 'GET' })
		expect(await res.text()).toBe('ok')
		expect(plain).toHaveBeenCalledWith('http://umami:3000/api/websites', { method: 'GET' })
		await open.close()
	})
})

describe('followRedirects', () => {
	const redirect = (status: number, location: string) =>
		new Response(null, { status, headers: { location } })

	/** A `send` answering from a script, recording every hop it was handed. */
	const scripted = (...responses: Response[]): { send: SendHop; hops: Hop[] } => {
		const hops: Hop[] = []
		const send: SendHop = async (hop) => {
			hops.push(hop)
			return responses.shift() ?? new Response('done')
		}
		return { send, hops }
	}

	const credentials = {
		authorization: 'Bearer secret',
		'x-umami-api-key': 'secret',
		accept: 'application/json',
		'content-type': 'application/json',
	}

	it('follows a redirect on the same origin and keeps its credentials', async () => {
		const { send, hops } = scripted(redirect(302, '/v2'), new Response('final'))
		const res = await followRedirects(send, 'https://vendor.test/v1', { headers: credentials })
		expect(await res.text()).toBe('final')
		expect(hops.map((hop) => hop.url.href)).toEqual([
			'https://vendor.test/v1',
			'https://vendor.test/v2',
		])
		expect(hops[1]?.headers.authorization).toBe('Bearer secret')
	})

	it('sends no credential to another origin', async () => {
		const { send, hops } = scripted(redirect(307, 'https://elsewhere.test/x'), new Response('ok'))
		await followRedirects(send, 'https://vendor.test/v1', { headers: credentials })
		expect(hops[1]?.headers).toEqual({
			accept: 'application/json',
			'content-type': 'application/json',
		})
	})

	it('checks every hop: a redirect to a private address is refused unsent', async () => {
		const { send, hops } = scripted(redirect(302, 'https://10.0.0.1/admin'))
		await expect(followRedirects(send, 'https://vendor.test/')).rejects.toBeInstanceOf(
			HostRefusedError
		)
		expect(hops).toHaveLength(1)
	})

	it('checks every hop: a redirect off https is refused unsent', async () => {
		const { send, hops } = scripted(redirect(301, 'http://vendor.test/'))
		await expect(followRedirects(send, 'https://vendor.test/')).rejects.toBeInstanceOf(
			HostRefusedError
		)
		expect(hops).toHaveLength(1)
	})

	it('sends every hop through the guarded send, where its address is checked again', async () => {
		const { send, hops } = scripted(
			redirect(302, 'https://second.test/'),
			redirect(302, 'https://third.test/'),
			new Response('ok')
		)
		await followRedirects(send, 'https://first.test/')
		expect(hops.map((hop) => hop.url.host)).toEqual(['first.test', 'second.test', 'third.test'])
	})

	it(`gives up after ${MAX_REDIRECTS} redirects`, async () => {
		const { send, hops } = scripted(
			redirect(302, '/1'),
			redirect(302, '/2'),
			redirect(302, '/3'),
			redirect(302, '/4')
		)
		await expect(followRedirects(send, 'https://vendor.test/')).rejects.toThrow(/more than 3 times/)
		expect(hops).toHaveLength(MAX_REDIRECTS + 1)
	})

	it('turns a POST into a GET without its body on a 303, a 302 and a 301', async () => {
		for (const status of [301, 302, 303]) {
			const { send, hops } = scripted(redirect(status, '/after'), new Response('ok'))
			await followRedirects(send, 'https://vendor.test/', {
				method: 'POST',
				body: '{"a":1}',
				headers: { 'content-type': 'application/json', accept: '*/*' },
			})
			expect(hops[1]).toMatchObject({ method: 'GET', body: null, headers: { accept: '*/*' } })
			expect(hops[1]?.headers['content-type']).toBeUndefined()
		}
	})

	it('repeats the method and body on a 307 and a 308', async () => {
		for (const status of [307, 308]) {
			const { send, hops } = scripted(redirect(status, '/after'), new Response('ok'))
			await followRedirects(send, 'https://vendor.test/', { method: 'POST', body: '{"a":1}' })
			expect(hops[1]).toMatchObject({ method: 'POST', body: '{"a":1}' })
		}
	})

	it('hands a redirect back unfollowed in manual mode', async () => {
		const { send, hops } = scripted(redirect(302, 'https://elsewhere.test/'))
		const res = await followRedirects(send, 'https://vendor.test/', { redirect: 'manual' })
		expect(res.status).toBe(302)
		expect(hops).toHaveLength(1)
	})

	it('refuses a redirect in error mode', async () => {
		const { send } = scripted(redirect(302, '/after'))
		await expect(
			followRedirects(send, 'https://vendor.test/', { redirect: 'error' })
		).rejects.toThrow(TypeError)
	})

	it('returns a redirect status without a location as it is', async () => {
		const { send } = scripted(new Response(null, { status: 302 }))
		expect((await followRedirects(send, 'https://vendor.test/')).status).toBe(302)
	})

	it('checks the first request like any other', async () => {
		const { send, hops } = scripted()
		await expect(followRedirects(send, 'https://192.168.0.10/')).rejects.toBeInstanceOf(
			HostRefusedError
		)
		expect(hops).toHaveLength(0)
	})
})

describe('toStandardResponse', () => {
	it('keeps the status, headers and streamed body of undici answer', async () => {
		const answer = new UndiciResponse('{"ok":true}', {
			status: 201,
			statusText: 'Created',
			headers: { 'content-type': 'application/json', 'set-cookie': 'a=1' },
		})
		const res = toStandardResponse(answer)
		expect(res).toBeInstanceOf(Response)
		expect(res.status).toBe(201)
		expect(res.statusText).toBe('Created')
		expect(res.headers.get('content-type')).toBe('application/json')
		expect(await res.json()).toEqual({ ok: true })
	})

	it('carries no body on a status that cannot have one', () => {
		const res = toStandardResponse(new UndiciResponse(null, { status: 204 }))
		expect(res.status).toBe(204)
		expect(res.body).toBeNull()
	})
})
