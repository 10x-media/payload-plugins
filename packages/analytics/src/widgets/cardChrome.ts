import type { CSSProperties } from 'react'

export const cardStyle: CSSProperties = {
	display: 'flex',
	flexDirection: 'column',
	gap: '0.375rem',
	padding: 'var(--base, 1rem)',
	background: 'var(--theme-elevation-50)',
	border: '1px solid var(--theme-elevation-150)',
	borderRadius: 'var(--style-radius-m, 6px)',
	boxSizing: 'border-box',
}

export const labelStyle: CSSProperties = {
	fontSize: '0.6875rem',
	fontWeight: 600,
	letterSpacing: '0.04em',
	textTransform: 'uppercase',
	color: 'var(--theme-elevation-500)',
}
