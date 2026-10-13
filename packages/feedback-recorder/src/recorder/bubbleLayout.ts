/**
 * Where the camera circle sits, and how big it is.
 *
 * Everything here is a **fraction of the frame**, never a pixel: the same
 * layout has to mean the same thing on a small preview canvas in the drawer
 * and on a 4K screen capture, and the person dragging it is looking at the
 * former while the recording uses the latter. Storing pixels would make a
 * bubble that jumps when the screen resolution differs from the preview.
 *
 * - `x`, `y`: the circle's **centre**, as fractions of width and height.
 * - `radius`: as a fraction of the frame's **short edge**, so the circle stays
 *   round and keeps its apparent size whichever way the frame is oriented.
 *
 * That last choice is why clamping is not symmetrical: on a 16:9 frame a radius
 * of `0.1` is 10% of the height but only 5.6% of the width, so the horizontal
 * limit and the vertical one are different numbers. `clampBubble` is where that
 * asymmetry lives, and it is the reason this module is separate and tested.
 */
export type BubbleLayout = {
	x: number
	y: number
	radius: number
}

/** Below this it is a dot nobody can see themselves in. */
export const MIN_RADIUS = 0.04
/** Above this it stops being an overlay and starts being the recording. */
export const MAX_RADIUS = 0.3

/**
 * Bottom-right, at the size it was hard-coded to before it could be moved,
 * so somebody who never touches the control gets exactly what they had.
 */
export const DEFAULT_BUBBLE: BubbleLayout = { x: 0.84, y: 0.8, radius: 0.14 }

const finite = (value: number, fallback: number): number =>
	Number.isFinite(value) ? value : fallback

const clampTo = (value: number, low: number, high: number): number =>
	Math.min(high, Math.max(low, value))

/**
 * The layout with the whole circle inside the frame, and a radius worth drawing.
 *
 * `aspect` is width ÷ height. A nonsense one is treated as square rather than
 * allowed to divide by zero: a wrong-but-finite bubble is recoverable by
 * dragging it, a `NaN` one disappears and cannot be got back.
 */
export const clampBubble = (layout: BubbleLayout, aspect: number): BubbleLayout => {
	const safeAspect = Number.isFinite(aspect) && aspect > 0 ? aspect : 1
	const radius = clampTo(finite(layout.radius, DEFAULT_BUBBLE.radius), MIN_RADIUS, MAX_RADIUS)

	// The radius is measured against the short edge, so convert it into each
	// axis's own fraction before working out how close to the edge it may sit.
	const halfWidth = safeAspect >= 1 ? radius / safeAspect : radius
	const halfHeight = safeAspect >= 1 ? radius : radius * safeAspect

	return {
		x: clampTo(finite(layout.x, DEFAULT_BUBBLE.x), halfWidth, 1 - halfWidth),
		y: clampTo(finite(layout.y, DEFAULT_BUBBLE.y), halfHeight, 1 - halfHeight),
		radius,
	}
}
