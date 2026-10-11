import type { CustomEventComponentProps } from '@10x-media/audit-logs/types'
import type { Payload } from 'payload'

type Props = CustomEventComponentProps & { payload?: Payload }

const row = { display: 'flex', gap: 'calc(var(--base) * 0.5)' } as const
const label = { color: 'var(--theme-elevation-500)', minWidth: 'calc(var(--base) * 5)' } as const

/**
 * Renderer for `order_refunded` entries. A server component, so it can read the
 * order the event points at: the entry only stores its id.
 */
export async function RefundEvent({ documentId, metadata, payload }: Props) {
	const order =
		payload && documentId
			? await payload.findByID({ collection: 'orders', id: documentId, depth: 0 }).catch(() => null)
			: null
	const amount = typeof metadata?.amount === 'number' ? metadata.amount : undefined

	return (
		<div style={{ display: 'grid', gap: 'calc(var(--base) * 0.25)', fontSize: '1rem' }}>
			<div style={row}>
				<span style={label}>Order</span>
				<strong>{order?.reference ?? documentId ?? 'unknown'}</strong>
			</div>
			<div style={row}>
				<span style={label}>Refunded</span>
				<span style={{ color: 'var(--theme-error-750)', fontWeight: 600 }}>
					{amount !== undefined ? `-${amount.toFixed(2)} EUR` : 'n/a'}
				</span>
				{typeof order?.total === 'number' && (
					<span style={{ color: 'var(--theme-elevation-500)' }}>
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
