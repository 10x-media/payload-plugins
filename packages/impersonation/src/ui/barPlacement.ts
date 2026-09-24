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

export type BarInset = { end: number; start: number }

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
 * How far the docked bar must stay clear of the nav. Uses the content column,
 * so closing the nav lets the bar grow into that space.
 */
export const measureNavInset = (): BarInset => {
	const wrap = document.querySelector('.template-default__wrap')
	if (wrap instanceof HTMLElement) {
		const rect = wrap.getBoundingClientRect()
		return {
			end: Math.max(0, Math.round(window.innerWidth - rect.right)),
			start: Math.max(0, Math.round(rect.left)),
		}
	}
	const nav = document.querySelector('aside.nav')
	if (!(nav instanceof HTMLElement) || !nav.classList.contains('nav--nav-open')) {
		return { end: 0, start: 0 }
	}
	const rect = nav.getBoundingClientRect()
	if (rect.width < 8) {
		return { end: 0, start: 0 }
	}
	if (rect.left <= 1) {
		return { end: 0, start: rect.width }
	}
	return { end: rect.width, start: 0 }
}

export const anchorsFor = ({
	header,
	inset,
	size,
	viewport,
}: {
	header: number
	inset: BarInset
	size: { height: number; width: number }
	viewport: { height: number; width: number }
}): Record<BarEdge, Point> => {
	const left = inset.start + MARGIN
	const right = Math.max(left, viewport.width - inset.end - size.width - MARGIN)
	const top = header + MARGIN
	const bottom = Math.max(top, viewport.height - size.height - MARGIN)
	const midY = Math.max(top, (viewport.height - size.height) / 2)
	const span = viewport.width - inset.start - inset.end - size.width
	const midX = inset.start + Math.max(MARGIN, span / 2)
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
