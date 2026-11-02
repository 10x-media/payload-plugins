import { describe, expect, it, vi } from 'vitest'

import type { ReservedClip } from '../recorder/transport'
import { createPluginTransport, EndpointError, fetchMyRecordings } from './transport'

const reserved: ReservedClip = {
	clipId: 'c1',
	videoId: 'v1',
	upload: { endpoint: 'https://tus', libraryId: 'lib', signature: 'sig', expires: 1 },
}

const answer = (status: number, body: unknown) =>
	vi.fn(async () => new Response(JSON.stringify(body), { status }))

const callOf = (mock: ReturnType<typeof vi.fn>) =>
	mock.mock.calls[0] as unknown as [string, RequestInit]

describe('createPluginTransport', () => {
	it('reserves with the meta spread into the body', async () => {
		const fetchImpl = answer(201, reserved)
		const transport = createPluginTransport('/api/feedback-recorder', fetchImpl)
		const result = await transport.reserve({
			source: 'capture',
			durationSeconds: 12,
			sizeBytes: 99,
			meta: { kind: 'bug', title: 'Broken', context: { pageUrl: 'https://x' } },
		})
		expect(result).toEqual(reserved)
		const [url, init] = callOf(fetchImpl)
		expect(url).toBe('/api/feedback-recorder/clips')
		expect(JSON.parse(String(init.body))).toEqual({
			source: 'capture',
			durationSeconds: 12,
			sizeBytes: 99,
			kind: 'bug',
			title: 'Broken',
			context: { pageUrl: 'https://x' },
		})
	})

	it('refuses a reservation without an upload target', async () => {
		const transport = createPluginTransport('/api/fr', answer(201, { clipId: 'c1' }))
		await expect(
			transport.reserve({
				source: 'capture',
				durationSeconds: 1,
				sizeBytes: 1,
				meta: { kind: 'feedback', context: {} },
			})
		).rejects.toMatchObject({ code: 'invalidReservation' })
	})

	it('surfaces the endpoint error code', async () => {
		const transport = createPluginTransport('/api/fr', answer(503, { error: 'notConfigured' }))
		const error = await transport.complete({ reserved, durationSeconds: 3 }).catch((e) => e)
		expect(error).toBeInstanceOf(EndpointError)
		expect(error).toMatchObject({ status: 503, code: 'notConfigured' })
	})

	it('completes and uploads audio against the clip id', async () => {
		const fetchImpl = vi.fn(async () => new Response('{}', { status: 200 }))
		const transport = createPluginTransport('/api/fr', fetchImpl)
		await transport.complete({ reserved, durationSeconds: undefined })
		await transport.uploadAudio?.({ reserved, audio: new Blob(['a'], { type: 'audio/webm' }) })
		const calls = fetchImpl.mock.calls as unknown as [string, RequestInit][]
		expect(calls[0]?.[0]).toBe('/api/fr/clips/c1/complete')
		expect(JSON.parse(String(calls[0]?.[1].body))).toEqual({})
		expect(calls[1]?.[0]).toBe('/api/fr/clips/c1/audio')
		expect(calls[1]?.[1].method).toBe('PUT')
	})
})

describe('fetchMyRecordings', () => {
	it('returns the docs array, or nothing', async () => {
		expect(await fetchMyRecordings('/api/fr', answer(200, { docs: [{ id: 'a' }] }))).toEqual([
			{ id: 'a' },
		])
		expect(await fetchMyRecordings('/api/fr', answer(200, {}))).toEqual([])
	})
})
