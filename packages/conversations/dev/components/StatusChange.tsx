import type { ChatServerSlotProps } from '@10x-media/conversations/rsc'

/**
 * A server-rendered message type: a status change, written by server code with
 * `postMessage({ type: 'person.status' })`. It reads the request, so it proves
 * the slot renders with the viewer's own `req`.
 */
export const StatusChange = ({ message, req }: ChatServerSlotProps) => {
	const data = (message?.data ?? {}) as { from?: string; to?: string }
	return (
		<div style={{ color: 'var(--theme-elevation-700)', fontSize: '0.8125rem' }}>
			Status changed from <strong>{data.from}</strong> to <strong>{data.to}</strong>
			<span style={{ opacity: 0.6 }}> · rendered on the server for {req.user?.email}</span>
		</div>
	)
}
