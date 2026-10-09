import { createServer, type Server } from 'node:http'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { deliver } from './deliver'

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
		const r = await deliver({ url: `${url}/ok`, body: '{}', headers: {}, timeoutMs: 1000 })
		expect(r.ok).toBe(true)
		expect(r.responseStatus).toBe(200)
		expect(r.responseBody).toBe('thanks')
		expect(r.durationMs).toBeGreaterThanOrEqual(0)
	})

	it('returns not-ok with the status on 5xx', async () => {
		const r = await deliver({ url: `${url}/boom`, body: '{}', headers: {}, timeoutMs: 1000 })
		expect(r.ok).toBe(false)
		expect(r.responseStatus).toBe(500)
	})

	it('keeps only the head of a large response body', async () => {
		const r = await deliver({ url: `${url}/huge`, body: '{}', headers: {}, timeoutMs: 1000 })
		expect(r.ok).toBe(true)
		expect(r.responseBody).toHaveLength(2_000)
	})

	/**
	 * Following a redirect would re-send the signed request to an address the operator never
	 * entered. The 3xx is the recorded outcome instead.
	 */
	it('does not follow a redirect', async () => {
		const before = okHits
		const r = await deliver({ url: `${url}/moved`, body: '{}', headers: {}, timeoutMs: 1000 })
		expect(r.ok).toBe(false)
		expect(r.responseStatus).toBe(302)
		expect(okHits).toBe(before)
	})

	it('returns an error on timeout', async () => {
		const r = await deliver({ url: `${url}/hang`, body: '{}', headers: {}, timeoutMs: 50 })
		expect(r.ok).toBe(false)
		expect(r.error).toBeDefined()
	})
})
