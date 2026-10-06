import type { JobLogSlotProps } from '@10x-media/jobs/types'

const CARD = {
	backgroundColor: 'var(--theme-elevation-100)',
	borderRadius: '4px',
	display: 'flex',
	flexDirection: 'column',
	gap: '4px',
	padding: 'calc(var(--base) / 2)',
} as const

/**
 * Server-rendered output block for the `sleep` task. A registered slot also runs
 * for an empty value, so an attempt that returned `{}` still gets a readable line
 * instead of disappearing the way the default JSON block would.
 */
export const SleepOutput = ({ entry, index, value }: JobLogSlotProps) => {
	const slept = (value as { sleptMs?: number } | undefined)?.sleptMs
	return (
		<div style={CARD}>
			<span>
				Attempt #{index + 1} {entry.state === 'failed' ? 'gave up' : 'finished'}
				{typeof slept === 'number' ? ` after ${slept}ms` : ' with no measured duration'}.
			</span>
			<span style={{ color: 'var(--theme-elevation-500)', fontSize: '0.75rem' }}>
				Rendered by SleepOutput (server)
			</span>
		</div>
	)
}
