import type { AuditLogsRowSlotProps, AuditLogsSlotServerProps } from '@10x-media/audit-logs/types'

/**
 * `rowBadges`: the departments the acting user belonged to when the entry was written,
 * named from `loadContext` and linking to the Department filter.
 */
export function DepartmentBadges({
	context,
	entry,
	filterHref,
}: AuditLogsRowSlotProps & AuditLogsSlotServerProps) {
	const ids = Array.isArray(entry.actorDepartments) ? (entry.actorDepartments as string[]) : []
	const names = (context?.departments ?? {}) as Record<string, string>
	return ids.map((id) => (
		<span className="al-badge al-badge--context" key={id}>
			<a className="al-badge__text" href={filterHref('department', id)}>
				{names[id] ?? id}
			</a>
		</span>
	))
}
