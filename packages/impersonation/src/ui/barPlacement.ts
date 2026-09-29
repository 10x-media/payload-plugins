export type BarEdge =
	| 'bottom'
	| 'bottom-left'
	| 'bottom-right'
	| 'left'
	| 'right'
	| 'top'
	| 'top-left'
	| 'top-right'

export type BarPlacement = {
	collapsed: boolean
	edge: BarEdge
}

export type Point = { x: number; y: number }

const STORAGE_KEY = 'impersonation-bar'
const MARGIN = 12

const EDGES: readonly BarEdge[] = [
	'top',
	'top-right',
	'right',
	'bottom-right',
	'bottom',
	'bottom-left',
	'left',
	'top-left',
]

export const isBarEdge = (value: unknown): value is BarEdge =>
	typeof value === 'string' && (EDGES as readonly string[]).includes(value)

export const readBarPlacement = (): BarPlacement => {
	if (typeof localStorage === 'undefined') {
		return { collapsed: false, edge: 'right' }
	}
	try {
		const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '') as {
			collapsed?: unknown
			edge?: unknown
		}
		return {
			collapsed: parsed.collapsed === true,
			edge: isBarEdge(parsed.edge) ? parsed.edge : 'right',
		}
	} catch {
		return { collapsed: false, edge: 'right' }
	}
}

export const writeBarPlacement = (placement: BarPlacement): void => {
	localStorage.setItem(STORAGE_KEY, JSON.stringify(placement))
}

/**
 * Layout viewport without scrollbars. `position: fixed` resolves against it, so
 * `window.innerWidth` would park a right-edge chip under the scrollbar.
 */
export const readViewport = (): { height: number; width: number } => ({
	height: document.documentElement.clientHeight,
	width: document.documentElement.clientWidth,
})

export const anchorsFor = ({
	header,
	size,
	viewport,
}: {
	header: number
	size: { height: number; width: number }
	viewport: { height: number; width: number }
}): Record<BarEdge, Point> => {
	const left = MARGIN
	const right = Math.max(left, viewport.width - size.width - MARGIN)
	const top = header + MARGIN
	const bottom = Math.max(top, viewport.height - size.height - MARGIN)
	const midY = Math.max(top, (viewport.height - size.height) / 2)
	const midX = Math.max(MARGIN, (viewport.width - size.width) / 2)
	return {
		bottom: { x: midX, y: bottom },
		'bottom-left': { x: left, y: bottom },
		'bottom-right': { x: right, y: bottom },
		left: { x: left, y: midY },
		right: { x: right, y: midY },
		top: { x: midX, y: top },
		'top-left': { x: left, y: top },
		'top-right': { x: right, y: top },
	}
}

/** Project a release point along the drag so a flick lands in the corner it was thrown toward. */
export const projectThrow = (point: Point, velocity: Point): Point => ({
	x: point.x + velocity.x * 220,
	y: point.y + velocity.y * 220,
})

export const nearestEdge = (point: Point, anchors: Record<BarEdge, Point>): BarEdge => {
	let best: BarEdge = 'right'
	let bestDistance = Number.POSITIVE_INFINITY
	for (const edge of EDGES) {
		const anchor = anchors[edge]
		const distance = (anchor.x - point.x) ** 2 + (anchor.y - point.y) ** 2
		if (distance < bestDistance) {
			best = edge
			bestDistance = distance
		}
	}
	return best
}
