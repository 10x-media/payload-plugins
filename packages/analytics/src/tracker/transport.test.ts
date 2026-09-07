import { beforeEach, describe, expect, it, vi } from 'vitest'
import { sendPayload } from './transport'
import type { TrackerWindow } from './types'

interface FakeWin {
	navigator: { sendBeacon?: (url: string, data: BodyInit) => boolean }
	fetch?: ReturnType<typeof vi.fn>
}

const asWin = (win: FakeWin): TrackerWindow => win as unknown as TrackerWindow

// jsdom's Blob has no `text()`, so read it the way the platform always allowed.
const blobText = (blob: Blob): Promise<string> =>
	new Promise((resolve, reject) => {
		const reader = new FileReader()
		reader.onload = () => resolve(String(reader.result))
		reader.onerror = () => reject(reader.error)
		reader.readAsText(blob)
	})

describe('sendPayload', () => {
	const body = { type: 'pageview', path: '/pricing' }
	let fetchMock: ReturnType<typeof vi.fn>

	beforeEach(() => {
		fetchMock = vi.fn(() => Promise.resolve(new Response(null, { status: 202 })))
	})

	it('posts a JSON blob through sendBeacon', async () => {
		const sendBeacon = vi.fn(() => true)
		sendPayload(asWin({ navigator: { sendBeacon }, fetch: fetchMock }), '/api/ingest', body)

		expect(sendBeacon).toHaveBeenCalledTimes(1)
		const [url, blob] = sendBeacon.mock.calls[0] as unknown as [string, Blob]
		expect(url).toBe('/api/ingest')
		expect(blob).toBeInstanceOf(Blob)
		expect(blob.type).toBe('application/json')
		expect(JSON.parse(await blobText(blob))).toEqual(body)
		expect(fetchMock).not.toHaveBeenCalled()
	})

	it('falls back to keepalive fetch when sendBeacon refuses the payload', () => {
		const sendBeacon = vi.fn(() => false)
		sendPayload(asWin({ navigator: { sendBeacon }, fetch: fetchMock }), '/api/ingest', body)

		expect(fetchMock).toHaveBeenCalledTimes(1)
		const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
		expect(url).toBe('/api/ingest')
		expect(init.method).toBe('POST')
		expect(init.keepalive).toBe(true)
		expect(init.credentials).toBe('same-origin')
		expect(init.body).toBe(JSON.stringify(body))
		expect(init.headers).toEqual({ 'content-type': 'application/json' })
	})

	it('falls back to fetch when sendBeacon is missing', () => {
		sendPayload(asWin({ navigator: {}, fetch: fetchMock }), '/api/ingest', body)

		expect(fetchMock).toHaveBeenCalledTimes(1)
	})

	it('falls back to fetch when sendBeacon throws', () => {
		const sendBeacon = vi.fn(() => {
			throw new Error('blocked')
		})
		sendPayload(asWin({ navigator: { sendBeacon }, fetch: fetchMock }), '/api/ingest', body)

		expect(fetchMock).toHaveBeenCalledTimes(1)
	})

	it('swallows a rejected fetch', async () => {
		const rejecting = vi.fn(() => Promise.reject(new Error('offline')))
		expect(() =>
			sendPayload(asWin({ navigator: {}, fetch: rejecting }), '/api/ingest', body)
		).not.toThrow()
		await Promise.resolve()
	})

	it('does nothing when neither transport exists', () => {
		expect(() => sendPayload(asWin({ navigator: {} }), '/api/ingest', body)).not.toThrow()
	})
})
