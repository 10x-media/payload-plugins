'use client'

import { useAuditLogRow } from '@10x-media/audit-logs/client'
import { useEffect, useState } from 'react'

/**
 * `afterRowDetails`: a client slot that waits for its row to open before doing any
 * work, which is what `useAuditLogRow` is for.
 */
export function RowStateNote() {
	const { entry, expanded } = useAuditLogRow()
	const [openedAt, setOpenedAt] = useState<string>()

	useEffect(() => {
		if (expanded && !openedAt) setOpenedAt(new Date().toLocaleTimeString())
	}, [expanded, openedAt])

	if (!openedAt) return null
	return (
		<div className="al-row__section">
			<div className="al-row__section-label">Row slot</div>
			<span>
				First opened at {openedAt}. Entry {String(entry.id)}.
			</span>
		</div>
	)
}
