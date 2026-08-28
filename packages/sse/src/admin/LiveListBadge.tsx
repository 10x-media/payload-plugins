'use client'

import { Link, useConfig, useListQuery } from '@payloadcms/ui'
import type { DefaultCellComponentProps } from 'payload'
import { useEffect, useRef, useState } from 'react'

import { usePayloadList } from '../client/usePayloadList'
import './tokens.css'

const FLASH_MS = 600

/**
 * List cell that subscribes to collection SSE mutations, refetches the list on
 * each generation bump, and flashes the cell value.
 */
export const LiveListBadge = ({
	cellData,
	collectionSlug,
	link,
	linkURL,
	rowData,
}: DefaultCellComponentProps) => {
	const { config } = useConfig()
	const listQuery = useListQuery()
	const collection = collectionSlug ?? ''
	const { generation } = usePayloadList({ collection })
	const [flash, setFlash] = useState(false)
	const prevGeneration = useRef(generation)

	useEffect(() => {
		if (!collection || generation === prevGeneration.current) {
			prevGeneration.current = generation
			return
		}
		prevGeneration.current = generation

		if (typeof listQuery.refineListData === 'function') {
			// Re-apply the current page so ListQuery rewrites search params / refetches.
			void listQuery.refineListData({ page: listQuery.query?.page ?? 1 })
		}

		setFlash(true)
		const timer = window.setTimeout(() => setFlash(false), FLASH_MS)
		return () => window.clearTimeout(timer)
	}, [collection, generation, listQuery])

	const display = cellData == null ? '' : String(cellData)
	const content = (
		<span className={flash ? 'sse-live-list-flash' : undefined} data-sse-flash={flash || undefined}>
			{display}
		</span>
	)

	if (link && collectionSlug && rowData?.id != null) {
		const adminRoute = config.routes?.admin ?? '/admin'
		const href =
			linkURL ??
			`${adminRoute}/collections/${collectionSlug}/${encodeURIComponent(String(rowData.id))}`
		return (
			<Link href={href} prefetch={false}>
				{content}
			</Link>
		)
	}

	return content
}
