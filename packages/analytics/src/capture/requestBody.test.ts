import { describe, expect, it } from 'vitest'
import { readCappedBody } from './requestBody'

const bytes = (n: number) => new Uint8Array(n).fill(65)

/** A body that fails mid-read, as a beacon from an unloading tab does. */
const erroring = () =>
	new Request('http://x.test', {
		method: 'POST',
		body: new ReadableStream<Uint8Array>({
			start(controller) {
				controller.enqueue(bytes(10))
			},
			pull(controller) {
				controller.error(new Error('client went away'))
			},
		}),
		// @ts-expect-error duplex is required for a stream body and absent from lib.dom
		duplex: 'half',
	})

/** A body whose length is only discoverable by reading it, as a chunked upload is. */
const chunked = (chunks: Uint8Array[]) =>
	new Request('http://x.test', {
		method: 'POST',
		body: new ReadableStream<Uint8Array>({
			start(controller) {
				for (const chunk of chunks) {
					controller.enqueue(chunk)
				}
				controller.close()
			},
		}),
		// @ts-expect-error duplex is required for a stream body and absent from lib.dom
		duplex: 'half',
	})

describe('readCappedBody', () => {
	it('reads a body under the cap', async () => {
		const req = new Request('http://x.test', { method: 'POST', body: bytes(100) })
		const out = await readCappedBody(req, 1024)
		expect(out).toEqual({ ok: true, body: expect.any(ArrayBuffer) })
		expect(out.ok && out.body.byteLength).toBe(100)
	})

	it('preserves the bytes exactly', async () => {
		const payload = new Uint8Array([0, 1, 2, 250, 255])
		const req = new Request('http://x.test', { method: 'POST', body: payload })
		const out = await readCappedBody(req, 1024)
		expect(out.ok && new Uint8Array(out.body)).toEqual(payload)
	})

	it('reads a body exactly at the cap', async () => {
		const out = await readCappedBody(
			new Request('http://x.test', { method: 'POST', body: bytes(64) }),
			64
		)
		expect(out.ok && out.body.byteLength).toBe(64)
	})

	it('rejects a declared content-length over the cap without reading the body', async () => {
		let touched = false
		const source = {
			headers: new Headers({ 'content-length': '2048' }),
			get body() {
				touched = true
				return null
			},
		}
		expect(await readCappedBody(source, 1024)).toEqual({ ok: false, reason: 'too-large' })
		expect(touched).toBe(false)
	})

	it('rejects an oversize body with no declared length', async () => {
		const req = new Request('http://x.test', { method: 'POST', body: bytes(2048) })
		expect(await readCappedBody(req, 1024)).toEqual({ ok: false, reason: 'too-large' })
	})

	it('rejects a chunked body that passes the cap mid-read', async () => {
		const req = chunked([bytes(600), bytes(600), bytes(600)])
		expect(req.headers.get('content-length')).toBeNull()
		expect(await readCappedBody(req, 1024)).toEqual({ ok: false, reason: 'too-large' })
	})

	it('accepts a chunked body that stays under the cap', async () => {
		const out = await readCappedBody(chunked([bytes(300), bytes(300)]), 1024)
		expect(out.ok && out.body.byteLength).toBe(600)
	})

	it('reads an empty body as zero bytes', async () => {
		const out = await readCappedBody(new Request('http://x.test', { method: 'POST' }), 1024)
		expect(out.ok && out.body.byteLength).toBe(0)
	})

	it('reports a stream that errors mid-read as unreadable rather than throwing', async () => {
		await expect(readCappedBody(erroring(), 1024)).resolves.toEqual({
			ok: false,
			reason: 'unreadable',
		})
	})

	it('reports an arrayBuffer that rejects as unreadable', async () => {
		const source = {
			headers: new Headers(),
			body: null,
			arrayBuffer: () => Promise.reject(new Error('client went away')),
		}
		await expect(readCappedBody(source, 1024)).resolves.toEqual({
			ok: false,
			reason: 'unreadable',
		})
	})
})
