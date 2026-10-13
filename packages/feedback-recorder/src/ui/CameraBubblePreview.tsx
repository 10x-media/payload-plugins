'use client'

import { useCallback, useEffect, useId, useRef } from 'react'
import { type BubbleLayout, clampBubble, MAX_RADIUS, MIN_RADIUS } from '../recorder/bubbleLayout'

/** How far one arrow-key press moves the bubble, as a fraction of the frame. */
const NUDGE = 0.02
/** How much one `+`/`-` press changes the radius. */
const RESIZE_STEP = 0.01

type CameraBubblePreviewProps = {
	/**
	 * The finished composite, screen, camera circle and the real aspect ratio ,
	 * not the bare camera. What is dragged here is the recording itself.
	 */
	stream: MediaStream
	bubble: BubbleLayout
	onChange: (next: BubbleLayout) => void
	/** Accessible name for the canvas, and the instructions read with it. */
	label: string
	hint: string
}

/**
 * Put your face where it is not in the way, over the frame about to be recorded.
 *
 * This draws the composite whole and adds nothing to it: the circle you see is
 * the circle the compositor is drawing, at the aspect ratio of the screen that
 * was actually picked. Dragging writes a layout the compositor reads on its
 * very next frame, so what moves under the pointer is the output, not a
 * picture of what we hope the output looks like.
 *
 * Which is why this cannot live in the recorder drawer: `getDisplayMedia` does
 * not prompt until recording starts, so before then there is no composite and
 * no real aspect ratio to place against. See `CameraPlacement`, and
 * `CameraCheck` for the look-at-yourself the drawer does offer.
 */
export const CameraBubblePreview = ({
	stream,
	bubble,
	onChange,
	label,
	hint,
}: CameraBubblePreviewProps) => {
	const hintId = useId()
	const canvasRef = useRef<HTMLCanvasElement | null>(null)
	const videoRef = useRef<HTMLVideoElement | null>(null)
	const bubbleRef = useRef(bubble)
	const draggingRef = useRef(false)

	useEffect(() => {
		bubbleRef.current = bubble
	}, [bubble])

	// One offscreen `<video>` for the stream, and one draw loop over it. The
	// element is never in the document: it exists to give the canvas something
	// to sample, exactly as the compositor's own does.
	useEffect(() => {
		const video = document.createElement('video')
		video.muted = true
		video.playsInline = true
		video.srcObject = stream
		videoRef.current = video

		let frame = 0
		const draw = () => {
			const canvas = canvasRef.current
			const context = canvas?.getContext('2d')
			if (canvas && context) {
				// Match the canvas to the source, so the aspect being dragged
				// against is the aspect being recorded rather than a guess.
				if (video.videoWidth > 0 && canvas.width !== video.videoWidth) {
					canvas.width = video.videoWidth
					canvas.height = video.videoHeight
				}
				context.drawImage(video, 0, 0, canvas.width, canvas.height)
			}
			frame = requestAnimationFrame(draw)
		}

		void video.play().catch(() => undefined)
		frame = requestAnimationFrame(draw)

		return () => {
			cancelAnimationFrame(frame)
			video.srcObject = null
			videoRef.current = null
		}
	}, [stream])

	const aspect = (): number => {
		const canvas = canvasRef.current
		return canvas && canvas.height > 0 ? canvas.width / canvas.height : 16 / 9
	}

	const moveTo = useCallback(
		(clientX: number, clientY: number): void => {
			const canvas = canvasRef.current
			if (!canvas) return
			const rect = canvas.getBoundingClientRect()
			if (rect.width === 0 || rect.height === 0) return
			onChange(
				clampBubble(
					{
						...bubbleRef.current,
						x: (clientX - rect.left) / rect.width,
						y: (clientY - rect.top) / rect.height,
					},
					rect.width / rect.height
				)
			)
		},
		[onChange]
	)

	const onPointerDown = (event: React.PointerEvent<HTMLCanvasElement>): void => {
		draggingRef.current = true
		event.currentTarget.setPointerCapture(event.pointerId)
		moveTo(event.clientX, event.clientY)
	}

	const onPointerMove = (event: React.PointerEvent<HTMLCanvasElement>): void => {
		if (!draggingRef.current) return
		moveTo(event.clientX, event.clientY)
	}

	const endDrag = (event: React.PointerEvent<HTMLCanvasElement>): void => {
		draggingRef.current = false
		if (event.currentTarget.hasPointerCapture(event.pointerId)) {
			event.currentTarget.releasePointerCapture(event.pointerId)
		}
	}

	const resizeBy = (delta: number): void => {
		onChange(
			clampBubble({ ...bubbleRef.current, radius: bubbleRef.current.radius + delta }, aspect())
		)
	}

	const nudge = (dx: number, dy: number): void => {
		onChange(
			clampBubble(
				{ ...bubbleRef.current, x: bubbleRef.current.x + dx, y: bubbleRef.current.y + dy },
				aspect()
			)
		)
	}

	// Everything the pointer can do, the keyboard can do. A bubble that can only
	// be placed by dragging is a bubble somebody who cannot drag has to accept
	// wherever it happens to be.
	const onKeyDown = (event: React.KeyboardEvent<HTMLCanvasElement>): void => {
		const handled: Record<string, () => void> = {
			ArrowLeft: () => nudge(-NUDGE, 0),
			ArrowRight: () => nudge(NUDGE, 0),
			ArrowUp: () => nudge(0, -NUDGE),
			ArrowDown: () => nudge(0, NUDGE),
			'+': () => resizeBy(RESIZE_STEP),
			'=': () => resizeBy(RESIZE_STEP),
			'-': () => resizeBy(-RESIZE_STEP),
		}
		const action = handled[event.key]
		if (!action) return
		event.preventDefault()
		action()
	}

	return (
		<div className="fr-bubble">
			{/* A focusable canvas with a name and described-by instructions, and
			    deliberately no `role`: `application` would be the obvious reach, and
			    it suppresses a screen reader's normal reading mode for everything
			    inside it, too heavy a price for a control whose whole interface is
			    four arrow keys and two buttons that are also rendered below. */}
			<canvas
				aria-describedby={hintId}
				aria-label={label}
				className="fr-bubble__canvas"
				height={360}
				onKeyDown={onKeyDown}
				onPointerCancel={endDrag}
				onPointerDown={onPointerDown}
				onPointerMove={onPointerMove}
				onPointerUp={endDrag}
				ref={canvasRef}
				tabIndex={0}
				width={640}
			/>
			<p className="fr-bubble__hint" id={hintId}>
				{hint}
			</p>
			<div className="fr-bubble__sizes">
				<button
					className="fr-bubble__size"
					disabled={bubble.radius <= MIN_RADIUS}
					onClick={() => resizeBy(-RESIZE_STEP)}
					type="button"
				>
					−
				</button>
				<button
					className="fr-bubble__size"
					disabled={bubble.radius >= MAX_RADIUS}
					onClick={() => resizeBy(RESIZE_STEP)}
					type="button"
				>
					+
				</button>
			</div>
		</div>
	)
}
