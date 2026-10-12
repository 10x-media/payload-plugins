/**
 * The only inline styles the plugin renders: custom properties for what only a render knows (a
 * share, a height, an anchor, a row count). Every other rule is a class in `analytics.css`.
 */
declare module 'react' {
	interface CSSProperties {
		'--analytics-bar'?: string
		'--analytics-chart-height'?: string
		'--analytics-rows'?: string
		'--analytics-x'?: string
		'--analytics-y'?: string
	}
}

export const cssPercent = (fraction: number): string => `${fraction * 100}%`

export const cssPx = (value: number): string => `${value}px`
