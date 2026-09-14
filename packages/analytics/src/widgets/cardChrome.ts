import type { CSSProperties } from 'react'

/**
 * The card chrome, as token values rather than only as style objects: the widgets apply them
 * inline (they are server-rendered and the package ships no stylesheet), while the analytics
 * view interpolates the same values into its own injected CSS, where hover and pressed states
 * need real selectors. One definition, so the two surfaces cannot drift apart.
 */
export const CARD_CHROME = {
	gap: '0.375rem',
	padding: 'var(--base, 1rem)',
	background: 'var(--theme-elevation-50)',
	border: '1px solid var(--theme-elevation-150)',
	radius: 'var(--style-radius-m, 6px)',
} as const

export const CARD_LABEL = {
	fontSize: '0.6875rem',
	fontWeight: 600,
	letterSpacing: '0.04em',
	textTransform: 'uppercase',
	color: 'var(--theme-elevation-500)',
} as const

export const cardStyle: CSSProperties = {
	display: 'flex',
	flexDirection: 'column',
	gap: CARD_CHROME.gap,
	padding: CARD_CHROME.padding,
	background: CARD_CHROME.background,
	border: CARD_CHROME.border,
	borderRadius: CARD_CHROME.radius,
	boxSizing: 'border-box',
}

export const labelStyle: CSSProperties = { ...CARD_LABEL }
