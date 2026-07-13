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
	taskLabels,
	workflowLabels,
}: DefaultCellComponentProps & {
	taskLabels?: Record<string, string>
	workflowLabels?: Record<string, string>
}) => {
	const { config } = useConfig()
	const title =
		(typeof cellData === 'string' && cellData) ||
		String(rowData?.workflowSlug || rowData?.taskSlug || '') ||
		'—'
	const workflowSlug = typeof rowData?.workflowSlug === 'string' ? rowData.workflowSlug : undefined
	const taskSlug = typeof rowData?.taskSlug === 'string' ? rowData.taskSlug : undefined
	const label =
		(workflowSlug && workflowLabels?.[workflowSlug]) ||
		(taskSlug && taskLabels?.[taskSlug]) ||
		undefined

	if (link && collectionSlug && rowData?.id != null) {
		const adminRoute = config.routes?.admin ?? '/admin'
		const href =
			linkURL ??
			`${adminRoute}/collections/${collectionSlug}/${encodeURIComponent(String(rowData.id))}`
		return (
			<Link href={href} prefetch={false}>
				<span title={label ? title : undefined}>{label ?? title}</span>
			</Link>
		)
	}

	return <span title={label ? title : undefined}>{label ?? title}</span>
}
