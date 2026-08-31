'use client'

import type { JobLogSlotProps } from '@10x-media/jobs/types'
import { useState } from 'react'

const CARD = {
	backgroundColor: 'var(--theme-error-100)',
	borderRadius: '4px',
	display: 'flex',
	flexDirection: 'column',
	gap: '4px',
	padding: 'calc(var(--base) / 2)',
} as const

const messageOf = (value: unknown): string => {
	if (typeof value === 'string') {
		return value
	}
	const message = (value as { message?: unknown } | null)?.message
	return typeof message === 'string' ? message : 'Unknown error'
}

/**
 * Client-rendered error block registered under the `'*'` wildcard, so every task
 * gets it. Holds local state, which is what a client component buys over the
 * server ones next to it.
 */
export const AttemptError = ({ value }: JobLogSlotProps) => {
	const [raw, setRaw] = useState(false)
	return (
		<div style={CARD}>
			<strong>{messageOf(value)}</strong>
			<button
				onClick={() => setRaw((prev) => !prev)}
				style={{
					alignSelf: 'flex-start',
					background: 'none',
					border: 'none',
					color: 'var(--theme-elevation-600)',
					cursor: 'pointer',
					font: 'inherit',
					padding: 0,
					textDecoration: 'underline',
				}}
				type="button"
			>
				{raw ? 'Hide raw error' : 'Show raw error'}
			</button>
			{raw ? (
				<pre style={{ fontSize: '0.75rem', margin: 0, whiteSpace: 'pre-wrap' }}>
					{JSON.stringify(value, null, 2)}
				</pre>
			) : null}
		</div>
	)
}
