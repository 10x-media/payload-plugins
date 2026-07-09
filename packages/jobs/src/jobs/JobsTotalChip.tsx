'use client'

import { Link, useListQuery } from '@payloadcms/ui'
import type { CSSProperties, ReactNode } from 'react'

const chipStyle: CSSProperties = { color: 'inherit', textDecoration: 'none' }

/**
 * The health bar's total chip. Inside the list view it resets search and filters
 * in place via the list-query context; outside one the context is an empty
 * default object, so it falls back to a plain link to the unfiltered list.
 */
export const JobsTotalChip = ({
	children,
	fallbackHref,
}: {
	children: ReactNode
	fallbackHref: string
}) => {
	const listQuery = useListQuery()
	if (typeof listQuery.refineListData !== 'function') {
		return (
			<Link href={fallbackHref} prefetch={false} style={chipStyle}>
				{children}
			</Link>
		)
	}
	return (
		<button
			// `search: undefined` and `where: {}` mirror Payload's own clearing values
			// (handleSearchChange and resetQueryPreset); mergeQuery only replaces keys
			// present in the incoming query, so both must be passed explicitly.
			onClick={() => void listQuery.refineListData({ page: 1, search: undefined, where: {} })}
			style={{
				...chipStyle,
				background: 'none',
				border: 'none',
				cursor: 'pointer',
				font: 'inherit',
				padding: 0,
			}}
			type="button"
		>
			{children}
		</button>
	)
}
