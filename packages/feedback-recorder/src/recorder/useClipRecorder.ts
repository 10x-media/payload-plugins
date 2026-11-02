'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import type { ClipMode } from './bitrate'
import type { BubbleLayout } from './bubbleLayout'
import { ClipUploader } from './ClipUploader'
import {
	type CaptureControls,
	type CapturedRecording,
	type CaptureOptions,
	captureRecording,
	DiscardedError,
} from './captureRecording'
import type { ClipTransport, ReservedClip } from './transport'

export type UseClipRecorderOptions<Meta> = {
	transport: ClipTransport<Meta>
	mode: ClipMode
	withCamera: boolean
	bubble: BubbleLayout
}

export type ClipRecorderState =
	| 'idle'
	| 'requesting'
	| 'placing'
	| 'counting'
	| 'recording'
	| 'paused'
	| 'review'
	| 'uploading'
	| 'processing'
	| 'ready'
	| 'failed'

/**
 * States `start()` refuses to interrupt. A countdown already holds a screen share and a paused
 * recording is still a recording, so both count as busy.
 */
const BUSY_STATES = new Set<ClipRecorderState>([
	'requesting',
	'placing',
	'counting',
	'recording',
	'paused',
	'uploading',
	'processing',
])

/** Why it failed, for the UI to turn into copy. `unsupported` never got as far as a prompt. */
export type ClipRecorderError =
	| 'unsupported'
	| 'reserve-failed'
	| 'permission-denied'
	| 'recording-failed'
	| 'upload-failed'
	| 'complete-failed'

export type ClipRecorderProgress = {
	sent: number
	total: number
}

/** What is held between stopping and sending: the take the person can watch, keep or throw away. */
export type HeldRecording = {
	video: Blob
	audio: Blob | null
	durationSeconds: number | undefined
	source: 'capture' | 'upload'
}

export type UseClipRecorderResult<Meta> = {
	state: ClipRecorderState
	/** The live camera while the camera switch is on, for a preview. Owned by this hook. */
	cameraStream: MediaStream | null
	/** True when the camera was asked for and refused or unavailable. */
	cameraError: boolean
	/** Seconds left before capture begins; 0 unless the state is `counting`. */
	countdown: number
	/** The live microphone while a capture runs, for a level meter. */
	micStream: MediaStream | null
	/** The composite while the camera bubble is being placed against the real frame. */
	placementStream: MediaStream | null
	/** The finished take, from `review` until it is sent or thrown away. */
	recording: HeldRecording | null
	confirmPlacement: () => void
	pause: () => void
	resume: () => void
	/** Throws the take away: mid-recording it stops the capture, in review it drops the held take. */
	discard: () => void
	start: () => void
	stop: () => void
	/** Holds a file picked from disk for review, as if it had just been recorded. */
	holdFile: (file: File) => void
	/** Reserves the clip, uploads the held take and completes it. Retries reuse the reservation. */
	send: (meta: Meta) => void
	/** Back to `idle` after `ready`, so the next recording starts clean. */
	reset: () => void
	error: ClipRecorderError | null
	clipId: string | null
	progress: ClipRecorderProgress | null
}

const isRecordingSupported = (): boolean =>
	typeof navigator !== 'undefined' &&
	typeof navigator.mediaDevices?.getDisplayMedia === 'function' &&
	typeof MediaRecorder !== 'undefined'

/**
 * The state machine for making a clip: capture the screen (with the microphone and optionally a
 * camera bubble), hold the take for review, then reserve the clip through the transport, push the
 * video to Bunny over tus and complete it. The audio-only track goes up last, best-effort, because
 * losing a transcript is worth far less than losing the clip.
 *
 * Reserving after the review, not before the capture, means a take that is thrown away never
 * creates a clip on the server. A failed upload or completion keeps the take, the reservation and
 * the tus upload, so `send` again continues from the last acknowledged chunk.
 *
 * The camera is composited into the one recorded video, not captured as a second track. See
 * `cameraOverlay.ts`.
 */
export const useClipRecorder = <Meta>({
	transport,
	mode,
	withCamera,
	bubble,
}: UseClipRecorderOptions<Meta>): UseClipRecorderResult<Meta> => {
	const [state, setState] = useState<ClipRecorderState>('idle')
	const [error, setError] = useState<ClipRecorderError | null>(null)
	const [clipId, setClipId] = useState<string | null>(null)
	const [progress, setProgress] = useState<ClipRecorderProgress | null>(null)
	const [recording, setRecording] = useState<HeldRecording | null>(null)

	const [cameraStream, setCameraStream] = useState<MediaStream | null>(null)
	const [cameraError, setCameraError] = useState(false)

	const stateRef = useRef<ClipRecorderState>('idle')
	const cameraStreamRef = useRef<MediaStream | null>(null)
	const controlsRef = useRef<CaptureControls | null>(null)
	const discardedRef = useRef(false)
	const recordingRef = useRef<HeldRecording | null>(null)
	const reservedRef = useRef<ReservedClip | null>(null)
	const uploadedRef = useRef(false)
	const uploaderRef = useRef<ClipUploader | null>(null)
	const transportRef = useRef(transport)

	const [countdown, setCountdown] = useState(0)
	const [micStream, setMicStream] = useState<MediaStream | null>(null)
	const [placementStream, setPlacementStream] = useState<MediaStream | null>(null)
	const placementDoneRef = useRef<(() => void) | null>(null)
	const stopSignalRef = useRef<(() => void) | null>(null)
	const mountedRef = useRef(true)

	useEffect(() => {
		transportRef.current = transport
	}, [transport])

	const setPhase = useCallback((next: ClipRecorderState): void => {
		stateRef.current = next
		setState(next)
	}, [])

	const hold = useCallback(
		(next: HeldRecording | null): void => {
			recordingRef.current = next
			reservedRef.current = null
			uploadedRef.current = false
			uploaderRef.current = null
			setRecording(next)
			setClipId(null)
			setProgress(null)
			setError(null)
			setPhase(next ? 'review' : 'idle')
		},
		[setPhase]
	)

	const waitForStop = useCallback(
		(): Promise<void> =>
			new Promise((resolve) => {
				stopSignalRef.current = resolve
			}),
		[]
	)

	const requestStop = useCallback((): void => {
		stopSignalRef.current?.()
		stopSignalRef.current = null
	}, [])

	const capture = useCallback(
		async (options: CaptureOptions): Promise<void> => {
			setError(null)
			setClipId(null)
			setProgress(null)

			if (!isRecordingSupported()) {
				setError('unsupported')
				setPhase('failed')
				return
			}

			setPhase('requesting')

			let captured: CapturedRecording
			try {
				captured = await captureRecording({
					options,
					waitForStop,
					requestStop,
					isMounted: () => mountedRef.current,
					onRecording: () => setPhase('recording'),
					cameraStream: cameraStreamRef.current,
					onCountdown: (remaining) => {
						setCountdown(remaining)
						if (remaining > 0) setPhase('counting')
					},
					onControls: (controls) => {
						controlsRef.current = controls
					},
					isDiscarded: () => discardedRef.current,
					onMicStream: setMicStream,
					awaitPlacement: (stream) =>
						new Promise((done) => {
							setPlacementStream(stream)
							setPhase('placing')
							placementDoneRef.current = () => {
								setPlacementStream(null)
								placementDoneRef.current = null
								done()
							}
						}),
				})
			} catch (captureError: unknown) {
				setMicStream(null)
				if (captureError instanceof DiscardedError) {
					setPhase('idle')
					return
				}
				setError(
					captureError instanceof DOMException && captureError.name === 'NotAllowedError'
						? 'permission-denied'
						: 'recording-failed'
				)
				setPhase('failed')
				return
			}

			setMicStream(null)
			hold({
				video: captured.videoBlob,
				audio: captured.audioBlob,
				durationSeconds: captured.durationSeconds,
				source: 'capture',
			})
		},
		[waitForStop, requestStop, setPhase, hold]
	)

	const deliver = useCallback(
		async (meta: Meta): Promise<void> => {
			const held = recordingRef.current
			if (!held) return
			setError(null)

			let reserved = reservedRef.current
			if (!reserved) {
				setPhase('uploading')
				try {
					reserved = await transportRef.current.reserve({
						source: held.source,
						durationSeconds: held.durationSeconds,
						sizeBytes: held.video.size,
						meta,
					})
				} catch {
					setError('reserve-failed')
					setPhase('failed')
					return
				}
				reservedRef.current = reserved
				setClipId(reserved.clipId)
			}

			if (!uploadedRef.current) {
				setPhase('uploading')
				const resuming = uploaderRef.current
				if (!resuming) setProgress({ sent: 0, total: held.video.size })
				const uploader =
					resuming ??
					new ClipUploader({
						file: held.video,
						endpoint: reserved.upload.endpoint,
						libraryId: reserved.upload.libraryId,
						videoId: reserved.videoId,
						signature: reserved.upload.signature,
						expires: reserved.upload.expires,
						onProgress: (sent, total) => setProgress({ sent, total }),
					})
				uploaderRef.current = uploader
				try {
					await (resuming ? uploader.resume() : uploader.start())
				} catch {
					setError('upload-failed')
					setPhase('failed')
					return
				}
				uploadedRef.current = true
			}

			setPhase('processing')
			try {
				await transportRef.current.complete({
					reserved,
					durationSeconds: held.durationSeconds,
				})
			} catch {
				setError('complete-failed')
				setPhase('failed')
				return
			}

			if (held.audio && transportRef.current.uploadAudio) {
				await transportRef.current
					.uploadAudio({ reserved, audio: held.audio })
					.catch(() => undefined)
			}

			recordingRef.current = null
			setRecording(null)
			setPhase('ready')
		},
		[setPhase]
	)

	/**
	 * The camera's life follows the switch, not a recording, so a person can see themselves and
	 * frame up before committing. `cancelled` covers a camera granted after the switch went off or
	 * the component went away, which would otherwise leave the camera light on.
	 */
	useEffect(() => {
		if (!withCamera) {
			setCameraError(false)
			return
		}

		let cancelled = false
		let granted: MediaStream | null = null

		void navigator.mediaDevices
			?.getUserMedia({ video: true })
			.then((stream) => {
				granted = stream
				if (cancelled) {
					for (const track of stream.getTracks()) track.stop()
					return
				}
				cameraStreamRef.current = stream
				setCameraStream(stream)
				setCameraError(false)
			})
			.catch(() => {
				if (!cancelled) setCameraError(true)
			})

		return () => {
			cancelled = true
			for (const track of granted?.getTracks() ?? []) track.stop()
			cameraStreamRef.current = null
			setCameraStream(null)
		}
	}, [withCamera])

	/** Read by the compositor every frame, so dragging the bubble mid-recording moves it in the video. */
	const bubbleRef = useRef(bubble)
	useEffect(() => {
		bubbleRef.current = bubble
	}, [bubble])

	const confirmPlacement = useCallback((): void => {
		placementDoneRef.current?.()
	}, [])

	const pause = useCallback((): void => {
		controlsRef.current?.pause()
		setPhase('paused')
	}, [setPhase])

	const resume = useCallback((): void => {
		controlsRef.current?.resume()
		setPhase('recording')
	}, [setPhase])

	const discard = useCallback((): void => {
		if (stateRef.current === 'review' || stateRef.current === 'failed') {
			hold(null)
			return
		}
		discardedRef.current = true
		requestStop()
	}, [requestStop, hold])

	const start = useCallback((): void => {
		if (BUSY_STATES.has(stateRef.current)) return
		discardedRef.current = false
		setCountdown(0)
		hold(null)
		void capture({ mode, withCamera, getBubbleLayout: () => bubbleRef.current })
	}, [capture, hold, mode, withCamera])

	const holdFile = useCallback(
		(file: File): void => {
			if (BUSY_STATES.has(stateRef.current)) return
			hold({ video: file, audio: null, durationSeconds: undefined, source: 'upload' })
		},
		[hold]
	)

	const send = useCallback(
		(meta: Meta): void => {
			if (BUSY_STATES.has(stateRef.current)) return
			void deliver(meta)
		},
		[deliver]
	)

	const reset = useCallback((): void => {
		if (BUSY_STATES.has(stateRef.current)) return
		hold(null)
	}, [hold])

	useEffect(() => {
		mountedRef.current = true
		return () => {
			mountedRef.current = false
			requestStop()
		}
	}, [requestStop])

	return {
		state,
		start,
		stop: requestStop,
		holdFile,
		send,
		reset,
		error,
		clipId,
		progress,
		recording,
		cameraStream,
		cameraError,
		countdown,
		micStream,
		placementStream,
		confirmPlacement,
		pause,
		resume,
		discard,
	}
}
