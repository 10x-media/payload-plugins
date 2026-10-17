import { type BubbleLayout, clampBubble } from './bubbleLayout'

/**
 * Chrome's insertable-streams API. Not in `lib.dom` yet, so declared to the
 * extent this file uses it.
 */
interface VideoTrackProcessor {
	readable: ReadableStream<VideoFrame>
}
type VideoTrackProcessorCtor = new (init: { track: MediaStreamTrack }) => VideoTrackProcessor

const trackProcessor = (): VideoTrackProcessorCtor | null => {
	const ctor = (globalThis as { MediaStreamTrackProcessor?: VideoTrackProcessorCtor })
		.MediaStreamTrackProcessor
	return ctor ?? null
}

interface CameraOverlayInput {
	screenStream: MediaStream
	cameraStream: MediaStream
	/**
	 * Read once per composed frame rather than passed once, so dragging the
	 * bubble mid-recording moves it in the recording too.
	 */
	getLayout: () => BubbleLayout
}

export interface CameraOverlay {
	/** The composited canvas as a video track, screen underneath, camera over it. */
	track: MediaStreamTrack
	/**
	 * The same track as a stream, for the placement overlay to display.
	 *
	 * Showing the real composite is the whole point of placing the camera after
	 * the screen has been picked: the aspect ratio of a shared window, an
	 * ultrawide monitor and a portrait display are all different, and a bubble
	 * positioned against a stand-in 16:9 lands somewhere else in every one of
	 * them.
	 */
	stream: MediaStream
	/** Ends compositing. Does not touch the source streams; the caller owns those. */
	stop: () => void
}

interface DrawCameraCircleInput {
	context: CanvasRenderingContext2D
	canvas: HTMLCanvasElement
	layout: BubbleLayout
	source: CanvasImageSource
	/** The source's own pixel dimensions, a `<video>` and a `VideoFrame` name theirs differently. */
	sourceWidth: number
	sourceHeight: number
}

/**
 * The camera, cropped to a square and clipped to a circle, wherever the layout
 * puts it.
 *
 * Takes a `CanvasImageSource` and its dimensions rather than a `<video>`, so
 * the same function serves the preview (which has a video element) and the
 * compositor (which has raw `VideoFrame`s and deliberately no element at all).
 * That shared use is the point: a preview drawn by its own code would be a
 * picture of what we hope is being recorded rather than of what is.
 */
export const drawCameraCircle = ({
	context,
	canvas,
	layout,
	source,
	sourceWidth,
	sourceHeight,
}: DrawCameraCircleInput): void => {
	if (sourceWidth === 0 || sourceHeight === 0) return
	if (canvas.width === 0 || canvas.height === 0) return

	const safe = clampBubble(layout, canvas.width / canvas.height)
	const radius = Math.round(Math.min(canvas.width, canvas.height) * safe.radius)
	const cx = Math.round(canvas.width * safe.x)
	const cy = Math.round(canvas.height * safe.y)

	const side = Math.min(sourceWidth, sourceHeight)
	const sx = (sourceWidth - side) / 2
	const sy = (sourceHeight - side) / 2

	context.save()
	context.beginPath()
	context.arc(cx, cy, radius, 0, Math.PI * 2)
	context.closePath()
	context.clip()
	context.drawImage(source, sx, sy, side, side, cx - radius, cy - radius, radius * 2, radius * 2)
	context.restore()
}

/**
 * One canvas, the screen underneath and the camera circle over it, published as
 * a single video track. This is why a clip is ever one file.
 *
 * **Driven by the tracks' own frames, not by `requestAnimationFrame`.** That is
 * not a preference: `requestAnimationFrame` is suspended in a hidden tab, and a
 * screen recording is made almost entirely while the tab doing the recording is
 * hidden, you are looking at the thing you are demonstrating. Driving the
 * composite from the render loop produced recordings that were a frozen frame
 * with the occasional update, which is precisely what was reported.
 *
 * `MediaStreamTrackProcessor` hands us frames as the capture pipeline produces
 * them, independent of whether anything is being painted. Where it is missing
 * we fall back to the render loop and say so, because a jerky recording beats
 * no recording, but that path carries the original limitation.
 */
export const composeCameraOverlay = ({
	screenStream,
	cameraStream,
	getLayout,
}: CameraOverlayInput): Promise<CameraOverlay> =>
	new Promise((resolve, reject) => {
		const [screenTrack] = screenStream.getVideoTracks()
		const [cameraTrack] = cameraStream.getVideoTracks()
		if (!screenTrack) {
			reject(new Error('No screen video track to compose.'))
			return
		}

		const settings = screenTrack.getSettings()
		const canvas = document.createElement('canvas')
		canvas.width = settings.width ?? 1280
		canvas.height = settings.height ?? 720
		const context = canvas.getContext('2d')
		if (!context) {
			reject(new Error('This browser will not give us a 2d canvas context.'))
			return
		}

		// `0` means the track emits a frame only when asked, so one composed
		// frame in is exactly one frame out, no duplicates while the screen is
		// still and no drops when it is busy.
		const stream = canvas.captureStream(0)
		const [track] = stream.getVideoTracks()
		if (!track) {
			reject(new Error('The composited canvas produced no video track.'))
			return
		}
		const publish = (): void => {
			;(track as CanvasCaptureMediaStreamTrack).requestFrame?.()
		}

		const Processor = trackProcessor()
		let stopped = false

		if (Processor && cameraTrack) {
			// The camera's most recent frame, redrawn under every screen frame.
			// The two tracks tick at their own rates and neither waits for the
			// other, which is what keeps them in step with real time rather than
			// with each other.
			let latestCamera: VideoFrame | null = null

			const pumpCamera = async (): Promise<void> => {
				const reader = new Processor({ track: cameraTrack }).readable.getReader()
				while (!stopped) {
					const { value, done } = await reader.read()
					if (done || !value) break
					latestCamera?.close()
					latestCamera = value
				}
				reader.cancel().catch(() => undefined)
			}

			const pumpScreen = async (): Promise<void> => {
				const reader = new Processor({ track: screenTrack }).readable.getReader()
				while (!stopped) {
					const { value, done } = await reader.read()
					if (done || !value) break
					context.drawImage(value, 0, 0, canvas.width, canvas.height)
					if (latestCamera) {
						drawCameraCircle({
							context,
							canvas,
							layout: getLayout(),
							source: latestCamera,
							sourceWidth: latestCamera.displayWidth,
							sourceHeight: latestCamera.displayHeight,
						})
					}
					value.close()
					publish()
				}
				reader.cancel().catch(() => undefined)
			}

			void pumpCamera()
			void pumpScreen()

			resolve({
				track,
				stream,
				stop: () => {
					stopped = true
					latestCamera?.close()
					latestCamera = null
				},
			})
			return
		}

		// Fallback: no insertable streams here. Draws from video elements on the
		// render loop, which freezes while the tab is hidden, the very failure
		// the path above exists to avoid. Better than refusing to record.
		const screenVideo = document.createElement('video')
		screenVideo.muted = true
		screenVideo.playsInline = true
		screenVideo.srcObject = screenStream

		const cameraVideo = document.createElement('video')
		cameraVideo.muted = true
		cameraVideo.playsInline = true
		cameraVideo.srcObject = cameraStream

		screenVideo.onloadedmetadata = () => {
			void screenVideo.play()
			void cameraVideo.play()

			let frameId = 0
			const draw = () => {
				context.drawImage(screenVideo, 0, 0, canvas.width, canvas.height)
				drawCameraCircle({
					context,
					canvas,
					layout: getLayout(),
					source: cameraVideo,
					sourceWidth: cameraVideo.videoWidth,
					sourceHeight: cameraVideo.videoHeight,
				})
				publish()
				frameId = requestAnimationFrame(draw)
			}
			frameId = requestAnimationFrame(draw)

			resolve({
				track,
				stream,
				stop: () => {
					stopped = true
					cancelAnimationFrame(frameId)
				},
			})
		}

		screenVideo.onerror = () => reject(new Error('Could not read the screen track.'))
	})

/**
 * Whether a camera can be composited into a recording *properly* in this
 * browser.
 *
 * The fallback path below draws on the render loop, which a hidden tab
 * suspends, and a screen recording is made almost entirely while the
 * recording tab is hidden. It produces a near-frozen video rather than a
 * degraded one, which is not a lesser version of the feature but a broken one.
 *
 * So the camera is offered only where insertable streams exist to drive the
 * composite from the capture pipeline instead. Screen-only recording is
 * unaffected everywhere: it never touches a canvas.
 */
export const canCompositeCamera = (): boolean => trackProcessor() !== null
