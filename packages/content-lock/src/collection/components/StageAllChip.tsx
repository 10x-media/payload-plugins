'use client'

import { Link, useListQuery } from '@payloadcms/ui'
import type { ReactNode } from 'react'

import './stageFilterBar.css'

/**
 * The filter bar's "All" chip. A plain link to the bare list URL keeps the
 * filter, because the list restores its last query from preferences; inside the
 * list view it clears search and filters in place through the list-query
 * context instead. Outside one the context is an empty default object, so it
 * falls back to the link.
 */
export const StageAllChip = ({ children, href }: { children: ReactNode; href: string }) => {
	const listQuery = useListQuery()
	if (typeof listQuery.refineListData !== 'function') {
		return (
			<Link className="content-lock-plain-link" href={href} prefetch={false}>
				{children}
			</Link>
		)
	}
	return (
		<button
			// `search: undefined` and `where: {}` mirror Payload's own clearing values; mergeQuery
			// only replaces keys present in the incoming query, so both are passed explicitly.
			className="content-lock-reset-button"
			onClick={() => void listQuery.refineListData({ page: 1, search: undefined, where: {} })}
			type="button"
		>
			{children}
		</button>
	)
}
