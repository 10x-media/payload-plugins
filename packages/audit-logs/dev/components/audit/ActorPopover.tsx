import type { AuditLogsRowSlotProps } from '@10x-media/audit-logs/types'

/**
 * `user`: what the entry stored about who acted. Shown for deleted users too, where it
 * is all that is left.
 */
export function ActorPopover({ context, entry, user }: AuditLogsRowSlotProps) {
	const ids = Array.isArray(entry.actorDepartments) ? (entry.actorDepartments as string[]) : []
	const names = (context?.departments ?? {}) as Record<string, string>
	return (
		<div style={{ display: 'grid', gap: 'var(--spacer-1)' }}>
			<span style={{ color: 'var(--color-text-secondary)' }}>
				{user?.deleted ? 'Deleted account, departments at the time' : 'Departments at the time'}
			</span>
			<span>{ids.length ? ids.map((id) => names[id] ?? id).join(', ') : 'None'}</span>
		</div>
	)
}
