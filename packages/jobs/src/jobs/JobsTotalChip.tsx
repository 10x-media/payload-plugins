'use client'

import { Link, useListQuery } from '@payloadcms/ui'
import type { ReactNode } from 'react'

import './jobs.css'

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
			<Link className="jobs-plain-link" href={fallbackHref} prefetch={false}>
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
			className="jobs-reset-button"
			type="button"
		>
			{children}
		</button>
	)
}
