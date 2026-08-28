'use client'

import { Link, useConfig } from '@payloadcms/ui'
import type { DefaultCellComponentProps } from 'payload'
import { useEffect, useState } from 'react'

import { subscribeListFlash } from './listFlash'
import './tokens.css'

const FLASH_MS = 600

/**
 * List cell that flashes when LiveListSync signals a collection mutation.
 * Does not open a stream; one subscription lives on LiveListSync per list.
 */
export const LiveListBadge = ({
	cellData,
	collectionSlug,
	link,
	linkURL,
	rowData,
}: DefaultCellComponentProps) => {
	const { config } = useConfig()
	const collection = collectionSlug ?? ''
	const [flash, setFlash] = useState(false)

	useEffect(() => {
		if (!collection) return
		let timer: number | undefined
		const unsubscribe = subscribeListFlash((slug) => {
			if (slug !== collection) return
			setFlash(true)
			if (timer != null) window.clearTimeout(timer)
			timer = window.setTimeout(() => setFlash(false), FLASH_MS)
		})
		return () => {
			unsubscribe()
			if (timer != null) window.clearTimeout(timer)
		}
	}, [collection])

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
