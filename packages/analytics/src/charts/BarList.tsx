'use client'

import type { CSSProperties } from 'react'
import { type BarDatum, toBarRows } from './bars'

export interface BarListProps {
	data: BarDatum[]
	emptyLabel: string
}

const rowStyle: CSSProperties = {
	position: 'relative',
	display: 'flex',
	alignItems: 'center',
	justifyContent: 'space-between',
	padding: '0.3rem 0.5rem',
	borderRadius: 'var(--style-radius-s, 4px)',
	overflow: 'hidden',
}
const barStyle = (fraction: number): CSSProperties => ({
	position: 'absolute',
	inset: 0,
	transformOrigin: 'left',
	transform: `scaleX(${fraction})`,
	background: 'var(--theme-elevation-100)',
	borderRadius: 'inherit',
})
const labelStyle: CSSProperties = {
	position: 'relative',
	overflow: 'hidden',
	textOverflow: 'ellipsis',
	whiteSpace: 'nowrap',
	color: 'var(--theme-elevation-700)',
}
const valueStyle: CSSProperties = {
	position: 'relative',
	marginLeft: '0.75rem',
	fontVariantNumeric: 'tabular-nums',
	color: 'var(--theme-elevation-800)',
	fontWeight: 600,
}

/**
 * Ranked horizontal bar list: each row shows a label over a proportional fill (scaled
 * to the largest value) with the value at the right. Colors are Payload theme tokens,
 * so it tracks light/dark. Dependency-free.
 */
export function BarList({ data, emptyLabel }: BarListProps) {
	const rows = toBarRows(data)
	if (rows.length === 0) {
		return (
			<span style={{ color: 'var(--theme-elevation-400)', fontSize: '0.8125rem' }}>
				{emptyLabel}
			</span>
		)
	}
	return (
		<div
			style={{ display: 'flex', flexDirection: 'column', gap: '0.125rem', fontSize: '0.8125rem' }}
		>
			{rows.map((row) => (
				<div key={row.label} style={rowStyle}>
					<span aria-hidden style={barStyle(row.fraction)} />
					<span style={labelStyle}>{row.label}</span>
					<span style={valueStyle}>{row.display ?? row.value}</span>
				</div>
			))}
		</div>
	)
}
