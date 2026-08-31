import type { JobLogSlotProps } from '@10x-media/jobs/types'

const CARD = {
	backgroundColor: 'var(--theme-elevation-100)',
	borderRadius: '4px',
	display: 'flex',
	gap: 'var(--base)',
	padding: 'calc(var(--base) / 2)',
} as const

const format = (ms: number): string => (ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${ms}ms`)

/**
 * Server-rendered input block for the `sleep` task: the raw `{ ms }` payload read
 * as a duration. A server component here proves the seam supports them; it could
 * just as well hit the Local API.
 */
export const SleepInput = ({ value }: JobLogSlotProps) => {
	const ms = Number((value as { ms?: number } | undefined)?.ms ?? 0)
	return (
		<div style={CARD}>
			<div>
				<div style={{ color: 'var(--theme-elevation-500)', fontSize: '0.6875rem' }}>Requested</div>
				<strong style={{ fontSize: '1.125rem' }}>{format(ms)}</strong>
			</div>
			<div>
				<div style={{ color: 'var(--theme-elevation-500)', fontSize: '0.6875rem' }}>
					Rendered by
				</div>
				<code>SleepInput (server)</code>
			</div>
		</div>
	)
}
