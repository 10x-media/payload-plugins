import type { CustomEventComponentProps } from '@10x-media/audit-logs/types'
import type { Payload } from 'payload'

type Props = CustomEventComponentProps & { payload?: Payload }

const row = { display: 'flex', gap: 'var(--spacer-2)' } as const
const label = {
	color: 'var(--color-text-secondary)',
	minWidth: 'calc(var(--spacer-6) * 2)',
} as const

/**
 * Renderer for `order_refunded` entries. A server component, so it can read the
 * order the event points at: the entry only stores its id.
 */
export async function RefundEvent({ documentId, metadata, payload }: Props) {
	const order =
		payload && documentId
			? await payload
					.findByID({ collection: 'orders', depth: 0, id: documentId, overrideAccess: true })
					.catch(() => null)
			: null
	const amount = typeof metadata?.amount === 'number' ? metadata.amount : undefined

	return (
		<div style={{ display: 'grid', gap: 'var(--spacer-1)' }}>
			<div style={row}>
				<span style={label}>Order</span>
				<strong>{order?.reference ?? documentId ?? 'unknown'}</strong>
			</div>
			<div style={row}>
				<span style={label}>Refunded</span>
				<span style={{ color: 'var(--color-text-danger)', fontWeight: 600 }}>
					{amount !== undefined ? `-${amount.toFixed(2)} EUR` : 'n/a'}
				</span>
				{typeof order?.total === 'number' && (
					<span style={{ color: 'var(--color-text-secondary)' }}>
						of {order.total.toFixed(2)} EUR
					</span>
				)}
			</div>
			{typeof metadata?.sku === 'string' && (
				<div style={row}>
					<span style={label}>Item</span>
					<code>{metadata.sku}</code>
				</div>
			)}
			{typeof metadata?.reason === 'string' && (
				<div style={row}>
					<span style={label}>Reason</span>
					<span>{metadata.reason}</span>
				</div>
			)}
		</div>
	)
}
