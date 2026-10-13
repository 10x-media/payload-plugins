import { AUDIO_BITS_PER_SECOND, type ClipMode, videoBitsPerSecond } from './bitrate'
import type { BubbleLayout } from './bubbleLayout'
import { type CameraOverlay, composeCameraOverlay } from './cameraOverlay'

export interface CaptureOptions {
	mode: ClipMode
	withCamera: boolean
	/**
	 * Read per frame by the compositor, so moving the bubble mid-recording
	 * moves it in the recording. See `cameraOverlay`.
	 */
	getBubbleLayout: () => BubbleLayout
}

/** Three, as every recorder counts. Long enough to draw breath, short enough not to wait. */
const COUNTDOWN_SECONDS = 3

/**
 * Thrown when a take is discarded rather than failing.
 *
 * A distinct type because the hook must tell the two apart: a failure gets an
 * error state and a message, a discard goes quietly back to idle with the
 * drawer still open and ready for another go.
 */
export class DiscardedError extends Error {
	constructor() {
		super('The take was discarded.')
		this.name = 'DiscardedError'
	}
}

const pickSupportedMimeType = (candidates: string[]): string | undefined =>
	candidates.find((candidate) => MediaRecorder.isTypeSupported(candidate))

export interface CaptureControls {
	pause: () => void
	resume: () => void
}

export interface CapturedRecording {
	videoBlob: Blob
	audioBlob: Blob
	durationSeconds: number
}

export interface CaptureRecordingInput {
	options: CaptureOptions
	/** Resolves once `requestStop` (below) has been called. */
	waitForStop: () => Promise<void>
	/** The same function `useClipRecorder` hands back as `stop`. */
	requestStop: () => void
	/** False once the component asking for this has gone away. */
	isMounted: () => boolean
	/**
	 * The live camera, or null when it is off.
	 *
	 * **Owned by the caller, not by this function.** The hook acquires it the
	 * moment the camera is switched on, long before recording starts, so the
	 * person can see themselves and frame up, and releases it when the camera
	 * is switched off or the drawer goes away. Releasing it here would kill the
	 * preview the instant a recording stopped, which is the one moment somebody
	 * is most likely to want another take.
	 */
	cameraStream: MediaStream | null
	onRecording: () => void
	/**
	 * Ticks 3, 2, 1 after the screen has been picked and before anything is
	 * recorded, then 0 as capture begins.
	 *
	 * After the picker on purpose: counting down before it would count while
	 * somebody is still choosing a window, and start recording the instant they
	 * finished, which is the opposite of the point.
	 */
	onCountdown: (remaining: number) => void
	/**
	 * Hands back the two controls only the recorder itself can offer. Called
	 * once, as capture starts; the hook keeps them until the capture resolves.
	 */
	onControls: (controls: CaptureControls) => void
	/** True once the take has been thrown away, stop, and do not resolve a recording. */
	isDiscarded: () => boolean
	/**
	 * The microphone, once granted, for the level meter.
	 *
	 * Handed out rather than opened twice: a second `getUserMedia({ audio: true })`
	 * would be a second device indicator for the same microphone. The meter only
	 * exists while a capture does, which is the window where "can anybody hear
	 * me" is worth answering.
	 */
	onMicStream: (stream: MediaStream) => void
	/**
	 * Called once the composite exists and before anything is recorded, so the
	 * camera can be placed against the real frame.
	 *
	 * Only when there is a camera in the shot, a screen-only recording has
	 * nothing to place and must not be made to stop and confirm. Resolves when
	 * the person is happy, which is the signal to start counting down.
	 */
	awaitPlacement: (stream: MediaStream) => Promise<void>
}

/**
 * Everything from "ask for the screen" to "hand back two finished blobs",
 * the video (screen, composited with the camera when there is one, plus the
 * mixed screen-and-microphone audio) and the microphone alone, for the
 * transcript.
 *
 * Every device track this function opens is stopped in the `finally`,
 * whichever of the three ways it exits: the stop button, an error, or the
 * browser's own "Stop sharing" control ending the screen track early. A
 * screen share left running after the recording ends is the bug everyone
 * ships once.
 */
export const captureRecording = async ({
	options,
	waitForStop,
	requestStop,
	isMounted,
	onRecording,
	cameraStream,
	onCountdown,
	onControls,
	isDiscarded,
	onMicStream,
	awaitPlacement,
}: CaptureRecordingInput): Promise<CapturedRecording> => {
	// Pushed to as each device is granted, not built from the finished streams
	// afterwards, a share granted and then a microphone denied must still
	// release the share. Every exit past this point, whichever of the streams
	// below it happens between, goes through the same `finally`.
	const tracks: MediaStreamTrack[] = []
	let overlay: CameraOverlay | null = null
	let audioContext: AudioContext | null = null
	let released = false

	const releaseAll = (): void => {
		if (released) return
		released = true
		overlay?.stop()
		for (const track of tracks) track.stop()
		if (audioContext) void audioContext.close().catch(() => undefined)
	}

	try {
		const screenStream = await navigator.mediaDevices.getDisplayMedia({
			video: { frameRate: 30 },
			audio: true,
		})
		tracks.push(...screenStream.getTracks())

		const micStream = await navigator.mediaDevices.getUserMedia({ audio: true })
		tracks.push(...micStream.getTracks())
		onMicStream(micStream)

		// The camera arrives already open, from the hook, and its tracks are
		// deliberately NOT pushed onto `tracks`: this function releases what it
		// opened, and it did not open that.

		// The permission prompts above are the only unbounded wait before
		// recording starts, if the drawer that asked for this has since been
		// closed, there is nobody left to show `requesting`/`recording` to, and
		// the devices just acquired must not be left open for the life of the
		// tab.
		if (!isMounted()) throw new Error('The recorder was closed before capture could start.')

		audioContext = new AudioContext()
		const destination = audioContext.createMediaStreamDestination()
		const screenAudioTracks = screenStream.getAudioTracks()
		if (screenAudioTracks.length > 0) {
			audioContext.createMediaStreamSource(new MediaStream(screenAudioTracks)).connect(destination)
		}
		audioContext
			.createMediaStreamSource(new MediaStream(micStream.getAudioTracks()))
			.connect(destination)

		let videoTrack: MediaStreamTrack
		if (cameraStream) {
			overlay = await composeCameraOverlay({
				screenStream,
				cameraStream,
				getLayout: options.getBubbleLayout,
			})
			videoTrack = overlay.track
		} else {
			const [screenVideoTrack] = screenStream.getVideoTracks()
			if (!screenVideoTrack) throw new Error('No screen video track to record.')
			videoTrack = screenVideoTrack
		}

		const primaryStream = new MediaStream([videoTrack, ...destination.stream.getAudioTracks()])
		const audioOnlyStream = new MediaStream(micStream.getAudioTracks())

		const videoMimeType = pickSupportedMimeType([
			'video/mp4;codecs=avc1,mp4a',
			'video/webm;codecs=vp9,opus',
		])
		const audioMimeType = pickSupportedMimeType(['audio/webm;codecs=opus'])

		const primaryChunks: Blob[] = []
		const audioChunks: Blob[] = []

		const primaryRecorder = new MediaRecorder(primaryStream, {
			...(videoMimeType ? { mimeType: videoMimeType } : {}),
			videoBitsPerSecond: videoBitsPerSecond(options.mode),
		})
		const audioRecorder = new MediaRecorder(audioOnlyStream, {
			...(audioMimeType ? { mimeType: audioMimeType } : {}),
			audioBitsPerSecond: AUDIO_BITS_PER_SECOND,
		})

		// `timeslice` 5000 below only controls how often `MediaRecorder` hands us
		// a `Blob`, these chunks are buffered here and assembled into one file
		// once the recorder stops, they are not pushed to Bunny as they arrive.
		// `ClipUploader` (see its own file) is only ever constructed after
		// `captureRecording` resolves, with the complete recording, so nothing
		// reaches Bunny until the person clicks stop. Uploading progressively
		// instead would need `ClipUploader` to accept a deferred-length source
		// rather than a fixed `Blob`, and confirmation that Bunny's TUS endpoint
		// honours `Upload-Defer-Length`, neither of which this codebase can
		// verify without live Bunny credentials.
		primaryRecorder.ondataavailable = (event) => {
			if (event.data.size > 0) primaryChunks.push(event.data)
		}
		audioRecorder.ondataavailable = (event) => {
			if (event.data.size > 0) audioChunks.push(event.data)
		}

		const primaryDone = new Promise<Blob>((resolve) => {
			primaryRecorder.onstop = () =>
				resolve(new Blob(primaryChunks, { type: primaryRecorder.mimeType || 'video/webm' }))
		})
		const audioDone = new Promise<Blob>((resolve) => {
			audioRecorder.onstop = () =>
				resolve(new Blob(audioChunks, { type: audioRecorder.mimeType || 'audio/webm' }))
		})

		// The camera is placed here rather than in the drawer, because this is the
		// first moment the real frame exists: its aspect ratio comes from what
		// was actually shared, and the composite being dragged over is the one
		// about to be recorded.
		if (overlay) {
			await awaitPlacement(overlay.stream)
			if (!isMounted()) throw new Error('The recorder was closed during placement.')
			if (isDiscarded()) throw new DiscardedError()
		}

		// Three seconds between picking a screen and being recorded, so nobody is
		// already mid-sentence when capture begins. Cancellable: closing the
		// drawer or discarding during the count leaves nothing running.
		for (let remaining = COUNTDOWN_SECONDS; remaining > 0; remaining -= 1) {
			onCountdown(remaining)
			await new Promise((resolve) => setTimeout(resolve, 1000))
			if (!isMounted()) throw new Error('The recorder was closed during the countdown.')
			if (isDiscarded()) throw new DiscardedError()
		}
		onCountdown(0)

		// Paused time must not count towards the duration the clip is stamped
		// with, so the clock is accumulated across runs rather than read as one
		// span from start to stop.
		let elapsedBeforePause = 0
		let runningSince = Date.now()

		primaryRecorder.start(5000)
		audioRecorder.start(5000)
		onRecording()

		onControls({
			pause: () => {
				if (primaryRecorder.state !== 'recording') return
				primaryRecorder.pause()
				audioRecorder.pause()
				elapsedBeforePause += Date.now() - runningSince
			},
			resume: () => {
				if (primaryRecorder.state !== 'paused') return
				primaryRecorder.resume()
				audioRecorder.resume()
				runningSince = Date.now()
			},
		})

		// The person can end this from two places: our own stop button, or the
		// browser's native "Stop sharing" control ending the screen track, both
		// resolve the same signal, so there is exactly one shutdown path below.
		screenStream.getVideoTracks()[0]?.addEventListener('ended', requestStop)

		await waitForStop()

		primaryRecorder.stop()
		audioRecorder.stop()

		const [videoBlob, audioBlob] = await Promise.all([primaryDone, audioDone])
		if (isDiscarded()) throw new DiscardedError()

		const recordedMs =
			elapsedBeforePause + (primaryRecorder.state === 'paused' ? 0 : Date.now() - runningSince)
		return { videoBlob, audioBlob, durationSeconds: Math.round(recordedMs / 1000) }
	} finally {
		releaseAll()
	}
}
