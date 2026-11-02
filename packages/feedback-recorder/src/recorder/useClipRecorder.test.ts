// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { DEFAULT_BUBBLE } from './bubbleLayout'
import type { ClipTransport, ReservedClip } from './transport'
import type { UseClipRecorderResult } from './useClipRecorder'

const uploads = vi.hoisted(() => ({
	created: 0,
	starts: 0,
	resumes: 0,
	failNext: false,
}))

vi.mock('./ClipUploader', () => ({
	ClipUploader: class {
		constructor() {
			uploads.created += 1
		}
		start = async () => {
			uploads.starts += 1
			if (uploads.failNext) {
				uploads.failNext = false
				throw new Error('network')
			}
		}
		resume = async () => {
			uploads.resumes += 1
		}
		abort = async () => undefined
	},
}))

vi.mock('./captureRecording', () => ({
	DiscardedError: class extends Error {},
	captureRecording: async (input: {
		onRecording: () => void
		waitForStop: () => Promise<void>
	}) => {
		input.onRecording()
		await input.waitForStop()
		return {
			videoBlob: new Blob(['video'], { type: 'video/webm' }),
			audioBlob: new Blob(['audio'], { type: 'audio/webm' }),
			durationSeconds: 9,
		}
	},
}))

const { useClipRecorder } = await import('./useClipRecorder')

const reserved: ReservedClip = {
	clipId: 'c1',
	videoId: 'v1',
	upload: { endpoint: 'https://tus', libraryId: 'l', signature: 's', expires: 1 },
}

const makeTransport = () => {
	const transport = {
		reserve: vi.fn(async () => reserved),
		complete: vi.fn(async () => undefined),
		uploadAudio: vi.fn(async () => undefined),
	} satisfies ClipTransport<{ title: string }>
	return transport
}

const render = (transport: ClipTransport<{ title: string }>) =>
	renderHook(() =>
		useClipRecorder({ transport, mode: 'instant', withCamera: false, bubble: DEFAULT_BUBBLE })
	)

beforeEach(() => {
	uploads.created = 0
	uploads.starts = 0
	uploads.resumes = 0
	uploads.failNext = false
	Object.defineProperty(navigator, 'mediaDevices', {
		configurable: true,
		value: { getDisplayMedia: vi.fn(), getUserMedia: vi.fn() },
	})
	vi.stubGlobal('MediaRecorder', class {})
})

afterEach(() => {
	cleanup()
	vi.unstubAllGlobals()
})

const recordAndStop = async (result: { current: UseClipRecorderResult<{ title: string }> }) => {
	act(() => result.current.start())
	await waitFor(() => expect(result.current.state).toBe('recording'))
	act(() => result.current.stop())
	await waitFor(() => expect(result.current.state).toBe('review'))
}

describe('useClipRecorder', () => {
	it('holds the take for review and creates nothing on the server until sent', async () => {
		const transport = makeTransport()
		const { result } = render(transport)
		await recordAndStop(result)
		expect(result.current.recording?.durationSeconds).toBe(9)
		expect(transport.reserve).not.toHaveBeenCalled()
	})

	it('reserves, uploads, completes and sends the audio, in that order', async () => {
		const transport = makeTransport()
		const { result } = render(transport)
		await recordAndStop(result)
		act(() => result.current.send({ title: 'Hello' }))
		await waitFor(() => expect(result.current.state).toBe('ready'))

		expect(transport.reserve).toHaveBeenCalledWith(
			expect.objectContaining({ source: 'capture', durationSeconds: 9, meta: { title: 'Hello' } })
		)
		expect(uploads.starts).toBe(1)
		expect(transport.complete).toHaveBeenCalledWith({ reserved, durationSeconds: 9 })
		expect(transport.uploadAudio).toHaveBeenCalledTimes(1)
		expect(result.current.clipId).toBe('c1')
		expect(result.current.recording).toBeNull()
	})

	it('keeps the take after a failed upload and resumes the same upload on retry', async () => {
		const transport = makeTransport()
		const { result } = render(transport)
		await recordAndStop(result)
		uploads.failNext = true
		act(() => result.current.send({ title: 'x' }))
		await waitFor(() => expect(result.current.state).toBe('failed'))
		expect(result.current.error).toBe('upload-failed')
		expect(result.current.recording).not.toBeNull()

		act(() => result.current.send({ title: 'x' }))
		await waitFor(() => expect(result.current.state).toBe('ready'))
		expect(transport.reserve).toHaveBeenCalledTimes(1)
		expect(uploads.created).toBe(1)
		expect(uploads.resumes).toBe(1)
	})

	it('reserves again after a failed reservation', async () => {
		const transport = makeTransport()
		transport.reserve.mockRejectedValueOnce(new Error('down'))
		const { result } = render(transport)
		await recordAndStop(result)
		act(() => result.current.send({ title: 'x' }))
		await waitFor(() => expect(result.current.error).toBe('reserve-failed'))
		act(() => result.current.send({ title: 'x' }))
		await waitFor(() => expect(result.current.state).toBe('ready'))
		expect(transport.reserve).toHaveBeenCalledTimes(2)
	})

	it('still finishes when the audio upload fails', async () => {
		const transport = makeTransport()
		transport.uploadAudio.mockRejectedValueOnce(new Error('s3'))
		const { result } = render(transport)
		await recordAndStop(result)
		act(() => result.current.send({ title: 'x' }))
		await waitFor(() => expect(result.current.state).toBe('ready'))
	})

	it('drops the take on discard in review', async () => {
		const transport = makeTransport()
		const { result } = render(transport)
		await recordAndStop(result)
		act(() => result.current.discard())
		expect(result.current.state).toBe('idle')
		expect(result.current.recording).toBeNull()
	})

	it('holds a picked file as an upload, without a duration', async () => {
		const transport = makeTransport()
		const { result } = render(transport)
		act(() => result.current.holdFile(new File(['v'], 'clip.mp4', { type: 'video/mp4' })))
		expect(result.current.state).toBe('review')
		act(() => result.current.send({ title: 'file' }))
		await waitFor(() => expect(result.current.state).toBe('ready'))
		expect(transport.reserve).toHaveBeenCalledWith(
			expect.objectContaining({ source: 'upload', durationSeconds: undefined })
		)
		expect(transport.uploadAudio).not.toHaveBeenCalled()
	})

	it('says unsupported without MediaRecorder', async () => {
		vi.stubGlobal('MediaRecorder', undefined)
		const { result } = render(makeTransport())
		act(() => result.current.start())
		await waitFor(() => expect(result.current.error).toBe('unsupported'))
		expect(result.current.state).toBe('failed')
	})
})
