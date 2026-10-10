import { createServer, type Server } from 'node:http'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { deliver } from './deliver'
import { transport } from './destination'

let server: Server
let url: string
let okHits = 0

beforeAll(async () => {
	server = createServer((req, res) => {
		if (req.url === '/huge') {
			res.writeHead(200, { 'content-type': 'text/plain' })
			res.end('x'.repeat(50_000))
			return
		}
		if (req.url === '/moved') {
			res.writeHead(302, { location: '/ok' })
			res.end()
			return
		}
		if (req.url === '/ok') {
			okHits += 1
			res.writeHead(200, { 'content-type': 'text/plain' })
			res.end('thanks')
			return
		}
		if (req.url === '/boom') {
			res.writeHead(500)
			res.end('nope')
			return
		}
		// /hang: never respond -> exercises the timeout
	})
	await new Promise<void>((resolve) => server.listen(0, resolve))
	const addr = server.address()
	if (addr === null || typeof addr === 'string') {
		throw new Error('no port')
	}
	url = `http://127.0.0.1:${addr.port}`
})

afterAll(async () => {
	await new Promise<void>((resolve) => server.close(() => resolve()))
})

describe('deliver', () => {
	it('returns ok + status + truncated body on 2xx', async () => {
		const r = await deliver({
			url: `${url}/ok`,
			body: '{}',
			headers: {},
			timeoutMs: 1000,
			guarded: false,
		})
		expect(r.ok).toBe(true)
		expect(r.responseStatus).toBe(200)
		expect(r.responseBody).toBe('thanks')
		expect(r.durationMs).toBeGreaterThanOrEqual(0)
	})

	it('returns not-ok with the status on 5xx', async () => {
		const r = await deliver({
			url: `${url}/boom`,
			body: '{}',
			headers: {},
			timeoutMs: 1000,
			guarded: false,
		})
		expect(r.ok).toBe(false)
		expect(r.responseStatus).toBe(500)
	})

	it('keeps only the head of a large response body', async () => {
		const r = await deliver({
			url: `${url}/huge`,
			body: '{}',
			headers: {},
			timeoutMs: 1000,
			guarded: false,
		})
		expect(r.ok).toBe(true)
		expect(r.responseBody).toHaveLength(2_000)
	})

	/**
	 * Following a redirect would re-send the signed request to an address the operator never
	 * entered. The 3xx is the recorded outcome instead.
	 */
	it('does not follow a redirect', async () => {
		const before = okHits
		const r = await deliver({
			url: `${url}/moved`,
			body: '{}',
			headers: {},
			timeoutMs: 1000,
			guarded: false,
		})
		expect(r.ok).toBe(false)
		expect(r.responseStatus).toBe(302)
		expect(okHits).toBe(before)
	})

	it('returns an error on timeout', async () => {
		const r = await deliver({
			url: `${url}/hang`,
			body: '{}',
			headers: {},
			timeoutMs: 50,
			guarded: false,
		})
		expect(r.ok).toBe(false)
		expect(r.error).toBeDefined()
	})

	/**
	 * The lookup stub is the socket's own lookup, so this is the rebinding case: whatever the name
	 * resolved to earlier, the address the socket is about to use is the one that is judged.
	 */
	it('refuses, at the socket, a name that resolves to a private address', async () => {
		const lookup = vi.spyOn(transport, 'lookup').mockImplementation(((
			_host: string,
			options: { all?: boolean },
			callback: (err: null, address: unknown, family?: number) => void
		) => {
			if (options.all) {
				callback(null, [{ address: '127.0.0.1', family: 4 }])
			} else {
				callback(null, '127.0.0.1', 4)
			}
		}) as never)
		const before = okHits
		const port = new URL(url).port
		const r = await deliver({
			url: `http://rebind.test:${port}/ok`,
			body: '{}',
			headers: {},
			timeoutMs: 1000,
			guarded: true,
		})
		expect(lookup).toHaveBeenCalled()
		expect(r.ok).toBe(false)
		expect(r.error).toMatch(/non-public address/)
		expect(okHits).toBe(before)
		lookup.mockRestore()
	})

	it('refuses a mixed public and private answer', async () => {
		const lookup = vi.spyOn(transport, 'lookup').mockImplementation(((
			_host: string,
			_options: unknown,
			callback: (err: null, address: unknown) => void
		) => {
			callback(null, [
				{ address: '93.184.216.34', family: 4 },
				{ address: '10.0.0.5', family: 4 },
			])
		}) as never)
		const r = await deliver({
			url: 'https://mixed.test/hook',
			body: '{}',
			headers: {},
			timeoutMs: 1000,
			guarded: true,
		})
		expect(r.ok).toBe(false)
		expect(r.error).toMatch(/non-public address/)
		lookup.mockRestore()
	})
})
