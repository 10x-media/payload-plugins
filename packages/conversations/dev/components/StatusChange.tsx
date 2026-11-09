import type { ChatServerSlotProps } from '@10x-media/conversations/rsc'

/**
 * A server-rendered message type: a status change, written by server code with
 * `postMessage({ type: 'person.status' })`. It reads the request, so it proves
 * the slot renders with the viewer's own `req`.
 */
export const StatusChange = ({ message, req }: ChatServerSlotProps) => {
	const data = (message?.data ?? {}) as { from?: string; to?: string }
	return (
		<div
			style={{
				color: 'var(--color-text)',
				fontSize: 'var(--text-body-large-font-size)',
				lineHeight: 'var(--text-body-large-line-height)',
			}}
		>
			Status changed from <strong>{data.from}</strong> to <strong>{data.to}</strong>
			<span style={{ color: 'var(--color-text-secondary)' }}>
				{' '}
				· rendered on the server for {req.user?.email}
			</span>
		</div>
	)
}
