'use client'

import { Link, useConfig } from '@payloadcms/ui'
import type { DefaultCellComponentProps } from 'payload'

/**
 * List cell for the synced job title (workflow or task slug). Honors the linked
 * (first) column contract so the title navigates to the document, matching
 * Payload's default cell behavior.
 */
export const JobTitleCell = ({
	cellData,
	collectionSlug,
	link,
	linkURL,
	rowData,
}: DefaultCellComponentProps) => {
	const { config } = useConfig()
	const title =
		(typeof cellData === 'string' && cellData) ||
		String(rowData?.workflowSlug || rowData?.taskSlug || '') ||
		'—'

	if (link && collectionSlug && rowData?.id != null) {
		const adminRoute = config.routes?.admin ?? '/admin'
		const href =
			linkURL ??
			`${adminRoute}/collections/${collectionSlug}/${encodeURIComponent(String(rowData.id))}`
		return (
			<Link href={href} prefetch={false}>
				{title}
			</Link>
		)
	}

	return <span>{title}</span>
}
