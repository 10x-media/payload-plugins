'use client'

import type { CSSProperties } from 'react'
import { buildSparkline } from './sparkline'

const VIEW_W = 100
const VIEW_H = 32

export interface TrendChartProps {
	values: number[]
	ariaLabel: string
	height?: number
}

const svgStyle = (height: number): CSSProperties => ({ width: '100%', height, display: 'block' })

/**
 * Dependency-free sparkline. Renders a normalized line plus a faint area fill that
 * stretches to the container width; colors come from Payload theme tokens so it
 * tracks light/dark automatically. `non-scaling-stroke` keeps the line crisp despite
 * the non-uniform horizontal stretch.
 */
export function TrendChart({ values, ariaLabel, height = 48 }: TrendChartProps) {
	const { line, area } = buildSparkline(values, { width: VIEW_W, height: VIEW_H })
	return (
		<svg
			role="img"
			aria-label={ariaLabel}
			viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
			preserveAspectRatio="none"
			style={svgStyle(height)}
		>
			{area ? <path d={area} fill="var(--theme-elevation-100)" stroke="none" /> : null}
			{line ? (
				<path
					d={line}
					fill="none"
					stroke="var(--theme-success-500, var(--theme-elevation-800))"
					strokeWidth={1.5}
					strokeLinecap="round"
					strokeLinejoin="round"
					vectorEffect="non-scaling-stroke"
				/>
			) : null}
		</svg>
	)
}
